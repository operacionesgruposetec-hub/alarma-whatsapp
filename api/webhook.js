export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body;

    if (body.event === 'MESSAGES_UPSERT' || body.event === 'messages.upsert') {
      const messageData = body.data;

      // Ignorar mensajes enviados por el propio bot para evitar bucles o duplicados
      if (messageData?.key?.fromMe) {
        return res.status(200).json({ status: 'Ignored: From me' });
      }

      const remoteJid = messageData?.key?.remoteJid || messageData?.remoteJid;
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      if (!isGroup) {
        return res.status(200).json({ status: 'Ignored: Not a group message' });
      }

      // Extraer remitente
      const rawParticipant = messageData?.key?.participant || messageData?.participant || messageData?.sender || '';
      
      // Si es una identidad tipo @lid, intentamos limpiar o usar un identificador estándar
      let cleanPhone = rawParticipant.split('@')[0].split(':')[0];
      cleanPhone = cleanPhone.replace(/[^0-9+]/g, '');
      
      if (cleanPhone && !cleanPhone.startsWith('+')) {
        cleanPhone = '+' + cleanPhone;
      }

      const pushName = messageData?.pushName || 'Vecino del Residencial';
      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 Alerta recibida en grupo de [${cleanPhone}] (${pushName}) -> Comando: [${cleanText}]`);

      // -----------------------------------------------------------------
      // CONSULTA A GOOGLE SHEETS
      // -----------------------------------------------------------------
      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      
      let datosResidente = {
        nombre: pushName !== 'Vecino del Residencial' ? pushName : `Vecino (${cleanPhone})`,
        domicilio: "Residencial General",
        latitud: 9.856000,
        longitud: -83.914000,
        foto: "https://images.unsplash.com/photo-1541872703-74c5e44368f9?q=80&w=1000&auto=format&fit=crop"
      };

      if (sheetApiUrl) {
        try {
          // Agregamos redirect: 'follow' para que fetch siga las redirecciones de Google
          const response = await fetch(`${sheetApiUrl}?telefono=${encodeURIComponent(cleanPhone)}`, {
            method: 'GET',
            redirect: 'follow'
          });

          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            if (data && data.encontrado) {
              datosResidente = {
                nombre: data.nombre || datosResidente.nombre,
                domicilio: data.domicilio || datosResidente.domicilio,
                latitud: data.latitud || datosResidente.latitud,
                longitud: data.longitud || datosResidente.longitud,
                foto: (data.foto && data.foto.startsWith('http')) ? data.foto : datosResidente.foto
              };
              console.log('✅ Residente encontrado en Google Sheet:', datosResidente.nombre);
            } else {
              console.log('⚠️ Número no registrado en Google Sheet, usando datos por defecto.');
            }
          } else {
            console.error('❌ Google Sheet no devolvió JSON. Verifica la URL y permisos.');
          }
        } catch (sheetError) {
          console.error('❌ Error consultando Google Sheet:', sheetError);
        }
      }

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // 1. ENVIAR TEXTO DESCRIPTIVO AL GRUPO
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

      // 2. ENVIAR FOTO DE LA CASA AL GRUPO
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

      // 3. ENVIAR UBICACIÓN GPS EXACTA AL GRUPO
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

      console.log('🚀 ¡Secuencia de alerta procesada con éxito!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
