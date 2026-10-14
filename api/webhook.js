export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body;

    if (body.event === 'MESSAGES_UPSERT' || body.event === 'messages.upsert') {
      const messageData = body.data;

      const remoteJid = messageData?.key?.remoteJid || messageData?.remoteJid;
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      if (!isGroup) {
        return res.status(200).json({ status: 'Ignored: Not a group message' });
      }

      const rawParticipant = messageData?.key?.participant || messageData?.participant || messageData?.sender || '';
      let cleanPhone = rawParticipant.split('@')[0].split(':')[0];
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

      console.log(`🎯 Alerta recibida en grupo [${remoteJid}] de [${cleanPhone}] (${pushName}) -> Comando: [${cleanText}]`);

      const residentesDB = {
        "+103693412229282": {
          nombre: "Ulises Martínez Pineda",
          domicilio: "Casa Principal",
          latitud: 9.856,
          longitud: -83.914
        },
        "+50660301041": {
          nombre: "Ulises Martínez Pineda",
          domicilio: "Casa Principal",
          latitud: 9.856,
          longitud: -83.914
        }
      };

      const datosResidente = residentesDB[cleanPhone] || {
        nombre: `Vecino (${pushName})`,
        domicilio: "Residencial General",
        latitud: 9.856,
        longitud: -83.914
      };

      console.log('✅ Generando alerta para:', datosResidente.nombre);

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      
      // Forzamos el nombre correcto de la instancia para evitar el error 404
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

      const textEndpoint = `${evolutionUrl}/message/sendText/${instanceName}`;
      console.log(`🚀 Enviando texto a: ${textEndpoint}`);

      const resText = await fetch(textEndpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          text: respuestaTexto
        })
      });

      const dataText = await resText.json();
      console.log('📡 Respuesta Envío Texto:', JSON.stringify(dataText));

      // 2. ENVIAR IMAGEN AL GRUPO
      const mediaEndpoint = `${evolutionUrl}/message/sendMedia/${instanceName}`;
      const imagenUrl = "https://images.unsplash.com/photo-1541872703-74c5e44368f9?q=80&w=1000&auto=format&fit=crop";

      await fetch(mediaEndpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          mediaMessage: {
            mediatype: "image",
            media: imagenUrl,
            caption: `🔴 ALERTA DE ALARMA VECINAL (${cleanText}) 🔴`
          }
        })
      });

      // 3. ENVIAR UBICACIÓN GPS AL GRUPO
      const locationEndpoint = `${evolutionUrl}/message/sendLocation/${instanceName}`;
      await fetch(locationEndpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          name: `Ubicación de Emergencia - ${datosResidente.nombre}`,
          address: datosResidente.domicilio,
          latitude: datosResidente.latitud,
          longitude: datosResidente.longitud
        })
      });

      console.log('🚀 ¡Secuencia de alerta enviada con éxito al grupo!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
