import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const evolutionUrl = process.env.EVOLUTION_API_URL;
const evolutionKey = process.env.EVOLUTION_API_KEY;
const evolutionInstance = process.env.EVOLUTION_INSTANCE;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body;

    // Imprimir el evento completo en los logs para depurar
    console.log("BODY RECIBIDO:", JSON.stringify(body, null, 2));

    if (body.event === 'MESSAGES_UPSERT' || body.event === 'messages.upsert') {
      const messageData = body.data;

      const remoteJid = messageData?.key?.remoteJid || messageData?.remoteJid;
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      if (!isGroup) {
        return res.status(200).json({ status: 'Ignored: Not a group message' });
      }

      // Buscar el texto en todas las ubicaciones posibles de Evolution API
      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || 
                          messageData?.message?.imageMessage?.caption || '';

      const cleanText = messageText.trim().toUpperCase();

      // Extraer teléfono
      const participant = messageData?.key?.participant || messageData?.participant || remoteJid || '';
      let rawPhone = participant.split('@')[0].replace(/[^0-9]/g, '');

      let senderPhone = rawPhone;
      if (senderPhone.length === 8) {
        senderPhone = '+506' + senderPhone;
      } else if (!senderPhone.startsWith('+')) {
        senderPhone = '+' + senderPhone;
      }

      console.log(`➡️ TEXTO CAPTURADO: "${cleanText}" | TELÉFONO: ${senderPhone}`);

      // Validar si es M, S, I o P
      if (['M', 'S', 'I', 'P'].includes(cleanText)) {
        console.log(`🎯 ¡Comando válido (${cleanText}) detectado! Buscando en Supabase...`);

        const { data: residente, error } = await supabase
          .from('residentes')
          .select('*, residenciales(*)')
          .eq('teléfono', senderPhone)
          .single();

        if (error || !residente) {
          console.error('❌ No se encontró el residente para el teléfono:', senderPhone);
          return res.status(200).json({ status: 'Residente no registrado' });
        }

        console.log('✅ Residente encontrado:', residente.nombre);

        const nombreResidente = residente.nombre || 'Desconocido';
        const domicilio = residente.domicilio || residente.residencial_id || 'No especificado';

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

        console.log('🚀 ¡Alerta enviada correctamente!');
      }
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error crítico en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
