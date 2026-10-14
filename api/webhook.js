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

      console.log(`🎯 Alerta en grupo. Remitente bruto: [${rawParticipant}] -> Comando: [${cleanText}]`);

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // TRADUCCIÓN INTELIGENTE DE LID USANDO EVOLUTION API
      if (rawParticipant.includes('@lid')) {
        try {
          console.log(`🔍 Intentando traducir LID consultando perfil en Evolution API...`);
          const profileRes = await fetch(`${evolutionUrl}/chat/fetchProfile/${instanceName}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ number: rawParticipant })
          });

          if (profileRes.ok) {
            const profileData = await profileRes.json();
            // Si la API devuelve el JID real del teléfono (ej: 50660301041@s.whatsapp.net)
            const realJid = profileData?.id || profileData?.jid || '';
            if (realJid && !realJid.includes('@lid')) {
              const extracted = realJid.split('@')[0].split(':')[0].replace(/\D/g, '');
              if (extracted) {
                cleanPhone = extracted;
                console.log(`✅ ¡Teléfono real traducido con éxito!: [${cleanPhone}]`);
              }
            }
          }
        } catch (err) {
          console.log(`⚠️ No se pudo traducir por perfil, intentando método alternativo...`);
        }
      }

      // Validación final: si después de intentar traducir sigue sin ser un número de teléfono válido para la hoja
      if (cleanPhone.length < 8) {
        console.log(`❌ No se obtuvo un número de teléfono válido tras la traducción.`);
        return res.status(200).json({ status: 'Ignored: Could not resolve real phone number' });
      }

      // -----------------------------------------------------------------
      // CONSULTA ESTRICTA A GOOGLE SHEETS CON EL NÚMERO REAL
      // -----------------------------------------------------------------
      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl) {
        try {
          console.log(`📊 Consultando Google Sheets con el número real: [${cleanPhone}]`);
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

      if (!datosResidente) {
        console.log(`❌ Alerta rechazada: El número [${cleanPhone}] no está autorizado en la base de datos.`);
        return res.status(200).json({ status: 'Ignored: Resident not found in database' });
      }

      console.log(`🚀 Enviando respuesta al grupo de WhatsApp...`);

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

      console.log('✨ ¡Secuencia de alerta procesada con éxito!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico general:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
