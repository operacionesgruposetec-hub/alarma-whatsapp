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
      
      // Extraemos el identificador limpio que llega de WhatsApp
      let cleanPhone = rawParticipant.split('@')[0].split(':')[0].replace(/\D/g, '');

      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 [1] Mensaje recibido de grupo. Participante: [${rawParticipant}] | Limpio: [${cleanPhone}] -> Comando: [${cleanText}]`);

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // -----------------------------------------------------------------
      // CONSULTA DIRECTA A GOOGLE SHEETS (Delegando la validación a la hoja)
      // -----------------------------------------------------------------
      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl) {
        try {
          console.log(`📊 [2] Consultando Google Sheets con el parámetro: [${cleanPhone}]`);
          // Enviamos tanto el teléfono limpio como el participante crudo por si la hoja quiere evaluarlo
          const urlConsulta = `${sheetApiUrl}?telefono=${encodeURIComponent(cleanPhone)}&participante=${encodeURIComponent(rawParticipant)}`;
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
            console.log(`✅ [3] Residente validado por Google Sheet: [${datosResidente.nombre}]`);
          } else {
            console.log(`⚠️ [3] Google Sheet indicó que el número [${cleanPhone}] no está registrado.`);
          }
        } catch (sheetError) {
          console.error(`❌ [3] Error consultando Google Sheet:`, sheetError.message);
        }
      }

      if (!datosResidente) {
        console.log(`❌ [4] Alerta rechazada: Google Sheets no autorizó el número.`);
        return res.status(200).json({ status: 'Ignored: Resident not found in database' });
      }

      console.log(`🚀 [5] Enviando respuesta multimedia al grupo de WhatsApp...`);

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

      console.log('✨ [6] ¡Secuencia de alerta completada con éxito!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
