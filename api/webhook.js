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

    if (body.event === 'MESSAGES_UPSERT' || body.event === 'messages.upsert') {
      const messageData = body.data;

      const remoteJid = messageData?.key?.remoteJid;
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      if (!isGroup) {
        return res.status(200).json({ status: 'Ignored: Not a group message' });
      }

      // Extraer el texto del mensaje
      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || '';

      const cleanText = messageText.trim().toUpperCase();

      // FILTRO ESTRICTO: Solo procesar si el mensaje es exactamente la letra 'M' o 'S'
      if (cleanText !== 'M' && cleanText !== 'S') {
        return res.status(200).json({ status: 'Ignored: Not an activation command' });
      }

      // Obtener el número de teléfono limpio del remitente desde el remoteJid del participante o clave
      const participantJid = messageData?.key?.participant || messageData?.participant || '';
      let rawPhone = participantJid.split('@')[0];

      if (!rawPhone || rawPhone.length > 15) {
        // Si el participante trae un ID largo, buscamos en otras propiedades del payload de Evolution
        rawPhone = messageData?.key?.remoteJid?.split('@')[0] || '';
      }

      rawPhone = rawPhone.replace(/[^0-9]/g, '');
      
      // Si el número es local de Costa Rica (8 dígitos), le anteponemos el +506
      let senderPhone = rawPhone;
      if (senderPhone.length === 8) {
        senderPhone = '+506' + senderPhone;
      } else if (!senderPhone.startsWith('+')) {
        senderPhone = '+' + senderPhone;
      }

      console.log(`¡Comando de alerta detectado! Texto: "${cleanText}" | Teléfono limpio: ${senderPhone}`);

      // Consultar el residente en Supabase por su teléfono
      const { data: residente, error } = await supabase
        .from('residentes')
        .select('*, residenciales(*)')
        .eq('teléfono', senderPhone)
        .single();

      if (error || !residente) {
        console.error('Residente no encontrado en Supabase para el teléfono:', senderPhone, error);
        return res.status(200).json({ status: 'Residente no registrado en BD' });
      }

      console.log('¡Residente encontrado en Supabase!', residente.nombre);

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
            caption: "🔴 ALERTA DE ALARMA VECINAL 🔴"
          }
        })
      });

      // 2. ENVIAR TEXTO
      const respuestaTexto = `👤 SR/SRA: ${nombreResidente}\n` +
        `🏠 DOMICILIO: ${domicilio}\n` +
        `📅 FECHA Y HORA: ${new Date().toLocaleString()}\n\n` +
        `⚠️ ATENCION VECINOS ⚠️`;

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

      console.log('¡Secuencia de alerta enviada con éxito!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
