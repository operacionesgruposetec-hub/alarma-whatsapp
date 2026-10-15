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
      
      // Capturamos el identificador crudo (puede ser número o LID)
      const rawParticipant = messageData?.key?.participant || messageData?.participant || messageData?.sender || '';
      
      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 Mensaje recibido en grupo. Remitente: [${rawParticipant}] -> Comando: [${cleanText}]`);

      // Limpieza genérica: Eliminamos sufijos de WhatsApp pero MANTENEMOS el identificador 
      // (ya sea el número o el LID) para que Google Apps Script lo busque de forma dinámica.
      const identificadorEnvio = rawParticipant.split('@')[0].split(':')[0].trim();

      console.log(`📊 Consultando Google Sheets con el identificador del remitente: [${identificadorEnvio}]`);

      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl) {
        try {
          // Enviamos el identificador al Apps Script sin quemar ningún número en Vercel
          const urlConsulta = `${sheetApiUrl}?telefono=${encodeURIComponent(identificadorEnvio)}`;
          
          const response = await fetch(urlConsulta, { 
            method: 'GET', 
            redirect: 'follow' 
          });

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
            console.log(`✅ ¡ÉXITO! Residente encontrado: [${datosResidente.nombre}]`);
          } else {
            console.log(`⚠️ La hoja respondió pero el identificador no hizo match.`);
          }
        } catch (sheetError) {
          console.error(`❌ Error crítico consultando Google Sheet:`, sheetError.message);
        }
      }

      if (!datosResidente) {
        console.log(`❌ Alerta detenida: El remitente no fue autorizado.`);
        return res.status(200).json({ status: 'Ignored: Not registered' });
      }

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

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
      if (datosResidente.latitud && datosResidente.longitud) {
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
      }

      console.log('🎉 ¡SECUENCIA DE ALARMA COMPLETADA!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico general:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
