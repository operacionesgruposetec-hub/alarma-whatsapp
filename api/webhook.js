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

      console.log(`🎯 Alerta recibida. Destino [${isGroup ? 'Grupo' : 'Privado'}]. Remitente: [${rawParticipant}] -> Comando: [${cleanText}]`);

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // Si es un grupo y viene con LID, intentamos consultar los participantes para rescatar el número real
      if (isGroup && rawParticipant.includes('@lid')) {
        try {
          const groupRes = await fetch(`${evolutionUrl}/group/participants/${instanceName}?groupJid=${encodeURIComponent(remoteJid)}`, {
            method: 'GET',
            headers: headers
          });

          if (groupRes.ok) {
            const participantsList = await groupRes.json();
            if (Array.isArray(participantsList)) {
              const member = participantsList.find(p => p.id === rawParticipant || p.lid === rawParticipant);
              if (member && member.id && !member.id.includes('@lid')) {
                const realPhone = member.id.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (realPhone) {
                  cleanPhone = realPhone;
                  console.log(`✅ Teléfono real traducido desde el grupo: [${cleanPhone}]`);
                }
              }
            }
          }
        } catch (evoErr) {
          console.log(`⚠️ No se pudo traducir el LID mediante la API del grupo.`);
        }
      }

      // -----------------------------------------------------------------
      // CONSULTA A GOOGLE SHEETS
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
            console.log(`✅ Residente encontrado en Google Sheet: [${datosResidente.nombre}]`);
          } else {
            console.log(`⚠️ El número [${cleanPhone}] no está registrado en la Columna B de Google Sheets.`);
          }
        } catch (sheetError) {
          console.error(`❌ Error consultando Google Sheet:`, sheetError.message);
        }
      }

      // Si el número no está en la base de datos, rechazamos la alerta estrictamente
      if (!datosResidente) {
        console.log(`❌ Alerta rechazada: El número [${cleanPhone}] no pertenece a ningún residente registrado.`);
        return res.status(200).json({ status: 'Ignored: Resident not found in database' });
      }

      // Destino de respuesta: si mandan comando por privado responde al privado, si es en grupo responde al grupo
      const destinoRespuesta = remoteJid;

      // 1. ENVIAR TEXTO
      const respuestaTexto = `👤 SR/SRA: ${datosResidente.nombre}\n` +
        `🏠 DOMICILIO: ${datosResidente.domicilio}\n` +
        `📅 FECHA Y HORA: ${new Date().toLocaleString()}\n\n` +
        `⚠️ ATENCION VECINOS (Comando: ${cleanText}) ⚠️`;

      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: destinoRespuesta,
          text: respuestaTexto
        })
      });

      // 2. ENVIAR FOTO
      if (datosResidente.foto) {
        await fetch(`${evolutionUrl}/message/sendMedia/${instanceName}`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            number: destinoRespuesta,
            mediaMessage: {
              mediatype: "image",
              media: datosResidente.foto,
              caption: `🔴 FOTO DE LA CASA - ALARMA VECINAL (${cleanText}) 🔴`
            }
          })
        });
      }

      // 3. ENVIAR UBICACIÓN GPS
      await fetch(`${evolutionUrl}/message/sendLocation/${instanceName}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: destinoRespuesta,
          name: `Ubicación - ${datosResidente.nombre}`,
          address: datosResidente.domicilio,
          latitude: datosResidente.latitud,
          longitude: datosResidente.longitud
        })
      });

      console.log('✨ ¡Secuencia de alerta completada con éxito!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico general:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
