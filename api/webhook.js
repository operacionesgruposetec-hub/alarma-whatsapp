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

      // Extraer de forma precisa el teléfono real ignorando el @lid si viene disponible en las propiedades de Evolution API
      const keyParticipant = messageData?.key?.participant || '';
      const dataParticipant = messageData?.participant || '';
      const senderJid = messageData?.sender || '';
      
      // Buscar entre las distintas propiedades cuál contiene un número de teléfono real (@s.whatsapp.net) en lugar de @lid
      let rawParticipant = [keyParticipant, dataParticipant, senderJid].find(p => p && p.includes('@s.whatsapp.net')) || keyParticipant || dataParticipant || senderJid;
      
      const pushName = messageData?.pushName || 'Vecino';

      // Limpiar para dejar únicamente los números puros (Ej: 50660301041)
      let cleanPhone = rawParticipant.split('@')[0].split(':')[0].replace(/\D/g, '');

      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 Alerta recibida. Teléfono extraído para consulta: [${cleanPhone}] | Nombre WhatsApp: [${pushName}] -> Comando: [${cleanText}]`);

      // -----------------------------------------------------------------
      // CONSULTA A GOOGLE SHEETS CON EL NÚMERO EXTRAÍDO
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
            console.log('✅ Residente encontrado en Google Sheet:', datosResidente.nombre);
          } else {
            console.log(`⚠️ El número [${cleanPhone}] no se encuentra en la Columna B de Google Sheets.`);
          }
        } catch (sheetError) {
          console.error('❌ Error consultando Google Sheet:', sheetError);
        }
      }

      // Si no coincide exactamente con la base de datos, se detiene la alerta
      if (!datosResidente) {
        console.log(`❌ Alerta rechazada: El número [${cleanPhone}] no está registrado en la base de datos.`);
        return res.status(200).json({ status: 'Ignored: Phone number not found in database' });
      }

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // 1. ENVIAR TEXTO CON DATOS EXCLUSIVOS DE GOOGLE SHEETS
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

      // 2. ENVIAR FOTO DE LA HOJA DE CÁLCULO
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

      // 3. ENVIAR UBICACIÓN GPS DE LA HOJA DE CÁLCULO
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

      console.log('🚀 ¡Alerta enviada con éxito utilizando los datos del residente!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
