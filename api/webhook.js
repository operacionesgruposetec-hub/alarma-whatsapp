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

      const rawParticipant = messageData?.key?.participant || messageData?.participant || messageData?.sender || '';
      
      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 Mensaje en grupo. Remitente bruto: [${rawParticipant}] -> Comando: [${cleanText}]`);

      // -----------------------------------------------------------------
      // FILTRO ESTRICTO: PROHIBIDO BUSCAR LIDS EN LA BASE DE DATOS
      // -----------------------------------------------------------------
      // Si el participante contiene '@lid', WhatsApp nos está ocultando el número real.
      // Como no tenemos el número real del residente, NUNCA debemos consultar Google Sheets.
      if (rawParticipant.includes('@lid')) {
        console.log(`🛑 BLOQUEO DE SEGURIDAD: El remitente es un ID interno de grupo (@lid). Como no es un número de teléfono real, SE DETIENE LA BÚSQUEDA para proteger la base de datos.`);
        return res.status(200).json({ status: 'Ignored: LID cannot be queried against phone database' });
      }

      // Si llegamos aquí, significa que SÍ es un número de teléfono real (ej: 506...)
      let cleanPhone = rawParticipant.split('@')[0].split(':')[0].replace(/\D/g, '');

      if (!cleanPhone || cleanPhone.length < 8) {
        console.log(`❌ El número extraído no es un teléfono válido.`);
        return res.status(200).json({ status: 'Ignored: Invalid phone' });
      }

      console.log(`📊 Teléfono real verificado para consulta: [${cleanPhone}]. Procediendo a consultar Google Sheets...`);

      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl) {
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
            console.log(`✅ Residente encontrado: [${datosResidente.nombre}]`);
          } else {
            console.log(`⚠️ El número [${cleanPhone}] no está registrado en la Columna B.`);
          }
        } catch (sheetError) {
          console.error(`❌ Error en Google Sheet:`, sheetError.message);
        }
      }

      if (!datosResidente) {
        console.log(`❌ Alerta rechazada: El número no está en la base de datos.`);
        return res.status(200).json({ status: 'Ignored: Not registered' });
      }

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // Enviar respuesta al grupo
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

      console.log('✨ ¡Alerta procesada con éxito!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
