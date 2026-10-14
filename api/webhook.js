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

      console.log(`🎯 Mensaje recibido en grupo [${remoteJid}] de [${cleanPhone}] (${pushName}) con comando: [${cleanText}]`);

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
        nombre: `${pushName} (${cleanPhone})`,
        domicilio: "Residencial General",
        latitud: 9.856,
        longitud: -83.914
      };

      console.log('✅ ¡Alerta generada y asociada para:', datosResidente.nombre);

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const evolutionInstance = process.env.EVOLUTION_INSTANCE;

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      const respuestaTexto = `👤 SR/SRA: ${datosResidente.nombre}\n` +
        `🏠 DOMICILIO: ${datosResidente.domicilio}\n` +
        `📅 FECHA Y HORA: ${new Date().toLocaleString()}\n\n` +
        `⚠️ ATENCION VECINOS (Comando: ${cleanText}) ⚠️`;

      // Probando la ruta alternativa de envío de texto de Evolution API (/message/sendText o /chat/sendText)
      const targetEndpoint = `${evolutionUrl}/message/sendText/${evolutionInstance}`;
      console.log(`🚀 Intentando enviar a: ${targetEndpoint}`);

      const resText = await fetch(targetEndpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          text: respuestaTexto
        })
      });

      const responseTextBody = await resText.text();
      console.log('📡 Código HTTP:', resText.status);
      console.log('📡 Cuerpo de Respuesta:', responseTextBody);

      console.log('🚀 ¡Secuencia de prueba ejecutada!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
