import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const evolutionUrl = process.env.EVOLUTION_API_URL;
const evolutionKey = process.env.EVOLUTION_API_KEY;
const evolutionInstance = process.env.EVOLUTION_INSTANCE;

export default async function handler(req, res) {
  // Asegurar que responda correctamente a las peticiones POST de Evolution API
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body;

    // Imprimir el payload en los logs de Vercel para depurar cualquier detalle
    console.log("Payload recibido de Evolution:", JSON.stringify(body, null, 2));

    // Aceptar tanto 'MESSAGES_UPSERT' como 'messages.upsert' por seguridad
    if (body.event === 'MESSAGES_UPSERT' || body.event === 'messages.upsert') {
      const messageData = body.data;

      const remoteJid = messageData?.key?.remoteJid;
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      if (!isGroup) {
        return res.status(200).json({ status: 'Ignored: Not a group message' });
      }

      const participantJid = messageData?.key?.participant || messageData?.participant || '';
      const senderPhone = participantJid.split('@')[0];

      // Aquí puedes continuar con tu lógica para guardar en Supabase o responder
      console.log(`Mensaje de grupo detectado de el número: ${senderPhone}`);
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error al procesar el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
