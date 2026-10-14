export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body;

    if (body.event === 'MESSAGES_UPSERT' || body.event === 'messages.upsert') {
      const messageData = body.data;

      if (messageData?.key?.fromMe) {
        return res.status(200).json({ status: 'Ignored: From me' });
      }

      const remoteJid = messageData?.key?.remoteJid || messageData?.remoteJid;
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      if (!isGroup) {
        return res.status(200).json({ status: 'Ignored: Not a group message' });
      }

      // Extraer datos del remitente
      const rawParticipant = messageData?.key?.participant || messageData?.participant || messageData?.sender || '';
      const pushName = messageData?.pushName || 'Vecino';
      
      let cleanPhone = rawParticipant.split('@')[0].split(':')[0].replace(/\D/g, '');

      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 Alerta en grupo. Participante bruto: [${rawParticipant}] -> Comando: [${cleanText}]`);

      // -----------------------------------------------------------------
      // CONSULTA A EVOLUTION API PARA OBTENER EL TELÉFONO REAL SI ES UN LID
      // -----------------------------------------------------------------
      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // Si el participante contiene '@lid', consultamos los datos del grupo o del contacto en Evolution API
      if (rawParticipant.includes('@lid')) {
        try {
          // Consultar información del grupo para mapear participantes reales
          const groupInfoRes = await fetch(`${evolutionUrl}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(remoteJid)}`, {
            method: 'GET',
            headers: headers
          });
          
          if (groupInfoRes.ok) {
            const groupData = await groupInfoRes.json();
            // Buscar en los participantes del grupo si alguno coincide con el LID para extraer su JID de teléfono real
            if (groupData && groupData.participants) {
              const miembro = groupData.participants.find(p => p.id === rawParticipant || (p.lid && p.lid === rawParticipant));
              if (miembro && miembro.id && !miembro.id.includes('@lid')) {
                let realPhoneExtracted = miembro.id.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (realPhoneExtracted) {
                  cleanPhone = realPhoneExtracted;
                  console.log(`✅ Teléfono real rescatado desde los participantes del grupo: [${cleanPhone}]`);
                }
              }
            }
          }
        } catch (apiErr) {
          console.error('⚠️ No se pudo consultar la info del grupo en Evolution API:', apiErr.message);
        }
      }

      // -----------------------------------------------------------------
      // CONSULTA A GOOGLE SHEETS USANDO EL NÚMERO REAL OBTENIDO
      // -----------------------------------------------------------------
      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl && cleanPhone) {
        try {
          const urlConsulta = `${sheetApiUrl}?telefono=${encodeURIComponent(cleanPhone)}`;
          const response = await fetch(urlConsulta, { redirect: 'follow' });
          const rawText = await response.text();

          const data = JSON.parse(rawText);
          if (data && data.encontrado) {
            datosResidente = {
              nombre: data.nombre,
              domicilio: data.domicilio,
              latitud: parseFloat(data.latitud),
              longitud: parseFloat(data.longitud),
              foto: data.foto
            };
            console.log('✅ Residente encontrado en Google Sheet para el número:', cleanPhone);
          } else {
            console.log(`⚠️ El número [${cleanPhone}] no está registrado en la Columna B de la hoja.`);
          }
        } catch (sheetError) {
          console.error('❌ Error consultando Google Sheet:', sheetError);
        }
      }

      if (!datosResidente) {
        console.log(`❌ Alerta rechazada: El número [${cleanPhone}] no está registrado en la base de datos.`);
        return res.status(200).json({ status: 'Ignored: Phone number not found in database' });
      }

      // 1. ENVIAR TEXTO CON DATOS DE LA HOJA
      const respuestaTexto = `👤 SR/SRA: ${datosResidente.nombre}\n` +
        `🏠 DOMICILIO: ${datosResidente.domicilio}\n` +
        `📅 FECHA Y HORA: ${new Date().toLocaleString()}\n\n` +
        `⚠️ ATENCION VECINOS (Comando: ${cleanText}) ⚠️`;

      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          text: respuestaTexto
        })
      });

      // 2. ENVIAR FOTO DE LA HOJA
      if (datosResidente.foto) {
        await fetch(`${evolutionUrl}/message/sendMedia/${instanceName}`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            number: remoteJid,
            mediaMessage: {
              mediatype: "image",
              media: datosResidente.foto,
              caption: `🔴 FOTO DE LA CASA - ALARMA VECINAL (${cleanText}) 🔴`
            }
          })
        });
      }

      // 3. ENVIAR UBICACIÓN GPS DE LA HOJA
      await fetch(`${evolutionUrl}/message/sendLocation/${instanceName}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          name: `Ubicación - ${datosResidente.nombre}`,
          address: datosResidente.domicilio,
          latitude: datosResidente.latitud,
          longitude: datosResidente.longitud
        })
      });

      console.log('🚀 ¡Alerta procesada con éxito consultando el grupo de Evolution API!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
