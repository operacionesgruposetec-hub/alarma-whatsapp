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
      
      // Extracción estricta del número real: limpiamos todo carácter que no sea número
      let cleanPhone = rawParticipant.replace(/\D/g, '');
      
      // Si el número es un identificador largo de WhatsApp (LID) que no contiene el número real,
      // tomamos los últimos dígitos o dejamos el número limpio que arroja la plataforma.
      // Para trabajar 100% con el número real de la persona:
      if (cleanPhone.length > 10) {
        // Opcional: si viene un LID muy largo, nos quedamos con la porción final o dejamos el string limpio
        cleanPhone = cleanPhone.slice(-10); // Toma los últimos 10 dígitos (ej: código de país + número local)
      }

      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 Alerta en grupo. Remitente bruto: [${rawParticipant}] | Teléfono real extraído para búsqueda: [${cleanPhone}] -> Comando: [${cleanText}]`);

      // -----------------------------------------------------------------
      // CONSULTA ESTRICTA A GOOGLE SHEETS USANDO EL NÚMERO REAL
      // -----------------------------------------------------------------
      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl && cleanPhone) {
        try {
          // Consultamos pasando el teléfono real extraído a Google Sheets
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
            console.log('✅ Coincidencia exacta encontrada en Google Sheet para el número:', cleanPhone);
          } else {
            console.log('⚠️ El número real [', cleanPhone, '] no está registrado en la Columna B de la hoja.');
          }
        } catch (sheetError) {
          console.error('❌ Error consultando Google Sheet:', sheetError);
        }
      }

      // Si el número real no está en la hoja, se detiene por completo (Sin datos ficticios)
      if (!datosResidente) {
        console.log('❌ Alerta rechazada: El número de teléfono no pertenece a ningun residente registrado.');
        return res.status(200).json({ status: 'Ignored: Phone number not found in database' });
      }

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // 1. ENVIAR TEXTO DESCRIPTIVO CON LOS DATOS DE LA HOJA
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

      // 2. ENVIAR FOTO DESDE LA BASE DE DATOS
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

      // 3. ENVIAR UBICACIÓN GPS DESDE LA BASE DE DATOS
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

      console.log('🚀 ¡Alerta procesada exitosamente con el número real de la base de datos!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
