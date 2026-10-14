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

      console.log(`🎯 [1] Mensaje recibido de grupo. Participante: [${rawParticipant}] | Comando: [${cleanText}]`);

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // Si es un LID, intentamos obtener el teléfono real consultando la API de grupos de forma segura con timeout
      if (rawParticipant.includes('@lid')) {
        try {
          console.log(`🔍 [2] Consultando Evolution API para traducir LID de grupo...`);
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000); // Límite de 4 segundos

          const groupInfoRes = await fetch(`${evolutionUrl}/group/findGroupInfos/${instanceName}?groupJid=${encodeURIComponent(remoteJid)}`, {
            method: 'GET',
            headers: headers,
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (groupInfoRes.ok) {
            const groupData = await groupInfoRes.json();
            if (groupData && groupData.participants) {
              const miembro = groupData.participants.find(p => p.id === rawParticipant || (p.lid && p.lid === rawParticipant));
              if (miembro && miembro.id && !miembro.id.includes('@lid')) {
                let realPhone = miembro.id.split('@')[0].split(':')[0].replace(/\D/g, '');
                if (realPhone) {
                  cleanPhone = realPhone;
                  console.log(`✅ [3] ¡LID traducido exitosamente a teléfono real!: [${cleanPhone}]`);
                }
              }
            }
          }
        } catch (apiErr) {
          console.log(`⚠️ [3] Aviso: No se pudo traducir el LID mediante Evolution API (${apiErr.message}), continuando con el flujo...`);
        }
      }

      // -----------------------------------------------------------------
      // CONSULTA A GOOGLE SHEETS
      // -----------------------------------------------------------------
      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl && cleanPhone) {
        try {
          console.log(`📊 [4] Consultando Google Sheets con el teléfono: [${cleanPhone}]`);
          const urlConsulta = `${sheetApiUrl}?telefono=${encodeURIComponent(cleanPhone)}&lid=${encodeURIComponent(rawParticipant)}`;
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
            console.log(`✅ [5] Residente encontrado en Google Sheet: [${datosResidente.nombre}]`);
          } else {
            console.log(`⚠️ [5] El número [${cleanPhone}] no se encontró en la Columna B de la hoja.`);
          }
        } catch (sheetError) {
          console.error(`❌ [5] Error consultando Google Sheet:`, sheetError.message);
        }
      }

      if (!datosResidente) {
        console.log(`❌ [6] Alerta rechazada: El número no está registrado en la base de datos.`);
        return res.status(200).json({ status: 'Ignored: Phone number not found in database' });
      }

      console.log(`🚀 [7] Enviando respuesta a WhatsApp...`);

      // 1. ENVIAR TEXTO
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

      // 2. ENVIAR FOTO
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

      // 3. ENVIAR UBICACIÓN GPS
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

      console.log('✨ [8] ¡Secuencia de alerta completada con éxito!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
