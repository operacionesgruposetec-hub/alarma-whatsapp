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

    if (body.event === 'MESSAGES-UPSERT' || body.event === 'messages.upsert') {
      const messageData = body.data;
      
      const remoteJid = messageData?.key?.remoteJid;
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      if (!isGroup) {
        return res.status(200).json({ status: 'Ignored: Not a group message' });
      }

      const participantJid = messageData?.key?.participant || messageData?.participant || '';
      const senderPhone = participantJid.split('@')[0];

      const messageContent = 
        messageData?.message?.conversation ||
        messageData?.message?.extendedTextMessage?.text ||
        '';

      const cleanCommand = messageContent.trim().toUpperCase();
      const validCommands = ['M', 'S', 'I', 'P'];

      if (validCommands.includes(cleanCommand)) {
        console.log(`Comando [${cleanCommand}] recibido de ${senderPhone} en el grupo ${remoteJid}`);

        // 1. Consultar residente en Supabase
        const { data: residente, error } = await supabase
          .from('residentes')
          .select('*, residenciales(*)')
          .eq('telefono', senderPhone)
          .single();

        if (error || !residente) {
          console.log(`Teléfono no autorizado: ${senderPhone}`);
          return res.status(200).json({ status: 'Unauthorized sender' });
        }

        const nombreResidente = residente.nombre || 'Residente';
        const casaResidente = residente.casa_lote || 'No especificada';

        let tipoAlerta = '';
        if (cleanCommand === 'M') tipoAlerta = 'Médica 🚑';
        if (cleanCommand === 'S') tipoAlerta = 'Seguridad / Asalto 🚨';
        if (cleanCommand === 'I') tipoAlerta = 'Incendio 🔥';
        if (cleanCommand === 'P') tipoAlerta = 'Pánico / General ⚠️';

        const respuestaTexto = `🚨 *ALERTA ACTIVADA* 🚨\n\n*Tipo:* ${tipoAlerta}\n*Reportado por:* ${nombreResidente}\n*Casa/Lote:* ${casaResidente}\n\n_El sistema ha registrado su aviso._`;

        // 2. Enviar respuesta de vuelta al grupo mediante Evolution API
        await fetch(`${evolutionUrl}/message/sendText/${evolutionInstance}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': evolutionKey
          },
          body: JSON.stringify({
            number: remoteJid,
            text: respuestaTexto
          })
        });

        return res.status(200).json({ 
          status: 'Success', 
          command: cleanCommand, 
          residente: nombreResidente 
        });
      }
    }

    return res.status(200).json({ status: 'Event received, no action needed' });

  } catch (err) {
    console.error('Error en el webhook:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
