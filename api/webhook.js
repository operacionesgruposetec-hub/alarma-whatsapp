import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

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

      const participantJid = messageData?.key?.participant || messageData?.participant || '';
      let senderPhone = participantJid.split('@')[0];

      if (!senderPhone.startsWith('+')) {
        senderPhone = '+' + senderPhone;
      }

      console.log(`Mensaje recibido de ${senderPhone}: "${messageText}"`);

      // Si el mensaje es la letra 'M' o 'S' para activar la alerta
      if (messageText.trim().toUpperCase() === 'M' || messageText.trim().toUpperCase() === 'S') {
        
        // Consultar el residente en Supabase por su teléfono
        const { data: residente, error } = await supabase
          .from('residentes')
          .select('*, residenciales(*)')
          .eq('teléfono', senderPhone)
          .single();

        if (error || !residente) {
          console.log('Residente no encontrado en la base de datos para el teléfono:', senderPhone);
          return res.status(200).json({ status: 'Residente no registrado' });
        }

        const nombreResidente = residente.nombre || 'Desconocido';
        const domicilio = residente.domicilio || residente.residencial_id || 'No especificado';

        // 1. ENVIAR LA IMAGEN DE EMERGENCIA (Puedes cambiar la URL por la imagen que desees mostrar)
        const imagenUrl = "https://images.unsplash.com/photo-1541872703-74c5e44368f9?q=80&w=1000&auto=format&fit=crop"; // URL de ejemplo o la foto de tu sistema
        
        await axios.post(
          `${evolutionUrl}/message/sendMedia/${evolutionInstance}`,
          {
            number: remoteJid,
            mediaMessage: {
              mediatype: "image",
              media: imagenUrl,
              caption: "🔴 ALERTA DE ALARMA VECINAL 🔴"
            }
          },
          {
            headers: {
              apikey: evolutionKey,
              'Content-Type': 'application/json'
            }
          }
        );

        // 2. ENVIAR EL TEXTO CON LOS DATOS DEL RESIDENTE
        const respuestaTexto = `👤 SR/SRA: ${nombreResidente}\n` +
          `🏠 DOMICILIO: ${domicilio}\n` +
          `📅 FECHA Y HORA: ${new Date().toLocaleString()}\n\n` +
          `⚠️ ATENCION VECINOS ⚠️`;

        await axios.post(
          `${evolutionUrl}/message/sendText/${evolutionInstance}`,
          {
            number: remoteJid,
            text: respuestaTexto
          },
          {
            headers: {
              apikey: evolutionKey,
              'Content-Type': 'application/json'
            }
          }
        );

        // 3. ENVIAR LA UBICACIÓN / COORDENADAS (Ejemplo con coordenadas de referencia, ajústalas si las guardas en Supabase)
        const latitud = residente.latitud || 9.856; // Si las guardas en Supabase, puedes usar residente.latitud
        const longitud = residente.longitud || -83.914; // Si las guardas en Supabase, puedes usar residente.longitud

        await axios.post(
          `${evolutionUrl}/message/sendLocation/${evolutionInstance}`,
          {
            number: remoteJid,
            name: `Ubicación de Emergencia - ${nombreResidente}`,
            address: domicilio,
            latitude: latitud,
            longitude: longitud
          },
          {
            headers: {
              apikey: evolutionKey,
              'Content-Type': 'application/json'
            }
          }
        );

        console.log('Alerta completa (Imagen, Texto y Ubicación) enviada exitosamente.');
      }
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error al procesar el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
