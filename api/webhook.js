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

      // Extraer número y nombre de perfil que envía el mensaje en WhatsApp
      const senderJid = messageData?.key?.participant || messageData?.participant || remoteJid;
      const senderPhone = '+' + senderJid.split('@')[0];
      const pushName = messageData?.pushName || messageData?.messageContextInfo?.deviceListMetadata?.pushName || 'Vecino del Residencial';

      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 Mensaje recibido de [${senderPhone}] (${pushName}) con comando: [${cleanText}]`);

      // -----------------------------------------------------------------
      // AQUÍ IRÁS AGREGANDO A TUS VECINOS UNO A UNO CONFORME LOS REGISTRES
      // -----------------------------------------------------------------
      const residentesDB = {
        "+50660301041": {
          nombre: "Ulises Martínez Pineda",
          domicilio: "Casa Principal",
          latitud: 9.856,
          longitud: -83.914
        },
        // Ejemplo para cuando agregues al siguiente vecino:
        // "+50688889999": {
        //   nombre: "Juan Pérez",
        //   domicilio: "Casa #15",
        //   latitud: 9.857,
        //   longitud: -83.915
        // }
      };

      // Si el número está en tu lista, usa tus datos. Si no, usa su nombre de WhatsApp de forma automática.
      const datosResidente = residentesDB[senderPhone] || {
        nombre: `${pushName} (${senderPhone})`,
        domicilio: "Residencial (Dirección pendiente de registro)",
        latitud: 9.856,
        longitud: -83.914
      };

      console.log('✅ ¡Alerta generada para:', datosResidente.nombre);

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const evolutionInstance = process.env.EVOLUTION_INSTANCE;

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // 1. ENVIAR IMAGEN DE ALERTA
      const imagenUrl = "https://images.unsplash.com/photo-1541872703-74c5e44368f9?q=80&w=1000&auto=format&fit=crop";
      await fetch(`${evolutionUrl}/message/sendMedia/${evolutionInstance}`, {
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

      // 2. ENVIAR TEXTO DESCRIPTIVO
      const respuestaTexto = `👤 SR/SRA: ${datosResidente.nombre}\n` +
        `🏠 DOMICILIO: ${datosResidente.domicilio}\n` +
        `📅 FECHA Y HORA: ${new Date().toLocaleString()}\n\n` +
        `⚠️ ATENCION VECINOS (Comando: ${cleanText}) ⚠️`;

      await fetch(`${evolutionUrl}/message/sendText/${evolutionInstance}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          text: respuestaTexto
        })
      });

      // 3. ENVIAR UBICACIÓN GPS
      await fetch(`${evolutionUrl}/message/sendLocation/${evolutionInstance}`, {
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

      console.log('🚀 ¡Secuencia de alerta completa enviada con éxito al grupo!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
