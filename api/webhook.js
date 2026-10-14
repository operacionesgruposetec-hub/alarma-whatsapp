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

      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      const targetPhone = '+50660301041';
      console.log(`🎯 Consultando Supabase por HTTP directo para el teléfono: [${targetPhone}]`);

      // Usar fetch directo a la API REST de Supabase para evitar errores de DNS del SDK
      const supabaseUrl = 'https://iljhfqeqpiencvtztxy.supabase.co';
      const supabaseKey = process.env.SUPABASE_ANON_KEY;

      const supabaseResponse = await fetch(`${supabaseUrl}/rest/v1/residentes?teléfono=eq.${encodeURIComponent(targetPhone)}`, {
        method: 'GET',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!supabaseResponse.ok) {
        console.error('❌ Error en la respuesta de Supabase:', supabaseResponse.statusText);
        return res.status(200).json({ status: 'Error en consulta Supabase' });
      }

      const residentes = await supabaseResponse.json();

      if (!residentes || residentes.length === 0) {
        console.error(`❌ No se encontró ningún residente para el teléfono: [${targetPhone}]`);
        return res.status(200).json({ status: 'Residente no registrado' });
      }

      const residente = residentes[0];
      console.log('✅ ¡Residente encontrado con éxito!', residente.nombre);

      const nombreResidente = residente.nombre || 'Desconocido';
      const domicilio = residente.domicilio || residente.residencial_id || 'No especificado';

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const evolutionInstance = process.env.EVOLUTION_INSTANCE;

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // 1. ENVIAR IMAGEN
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

      // 2. ENVIAR TEXTO
      const respuestaTexto = `👤 SR/SRA: ${nombreResidente}\n` +
        `🏠 DOMICILIO: ${domicilio}\n` +
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

      // 3. ENVIAR UBICACIÓN
      await fetch(`${evolutionUrl}/message/sendLocation/${evolutionInstance}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          name: `Ubicación de Emergencia - ${nombreResidente}`,
          address: domicilio,
          latitude: residente.latitud || 9.856,
          longitude: residente.longitud || -83.914
        })
      });

      console.log('🚀 ¡Secuencia de alerta completa enviada con éxito!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
