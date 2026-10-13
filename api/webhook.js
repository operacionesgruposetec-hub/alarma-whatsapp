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

    if (!body || !body.data) {
      return res.status(200).json({ status: 'Ignored: Empty body' });
    }

    const eventType = body.event || '';
    if (eventType !== 'MESSAGES_UPSERT' && eventType !== 'messages.upsert') {
      return res.status(200).json({ status: 'Ignored: Not message event' });
    }

    const messageData = body.data;
    const remoteJid = messageData?.key?.remoteJid || messageData?.remoteJid || '';
    
    if (!remoteJid.endsWith('@g.us')) {
      return res.status(200).json({ status: 'Ignored: Not a group message' });
    }

    // Extraer texto
    const messageText = messageData?.message?.conversation || 
                        messageData?.message?.extendedTextMessage?.text || 
                        messageData?.body || '';

    const cleanText = messageText.trim().toUpperCase();

    // FILTRO ESTRICTO: Solo M, S, I, P
    if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
      return res.status(200).json({ status: 'Omitted' });
    }

    console.log(`🎯 Comando válido detectado: "${cleanText}" en el grupo: ${remoteJid}`);

    // Para esta prueba, consultamos directo con tu número real registrado en Supabase para validar la respuesta completa
    const senderPhone = '+50660301041'; 

    const { data: residente, error } = await supabase
      .from('residentes')
      .select('*, residenciales(*)')
      .eq('teléfono', senderPhone)
      .single();

    if (error || !residente) {
      console.error('❌ Error buscando en Supabase:', error);
      return res.status(200).json({ status: 'Residente no encontrado' });
    }

    console.log('✅ ¡Residente encontrado!', residente.nombre);

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

    console.log('🚀 ¡Alerta enviada con éxito!');
    return res.status(200).json({ status: 'Success' });

  } catch (error) {
    console.error('Error crítico:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
