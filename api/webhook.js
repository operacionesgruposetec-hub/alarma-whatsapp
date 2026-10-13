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
    console.log("Evento recibido de Evolution:", JSON.stringify(body));

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

        // Consultar residente en Supabase de forma segura (sin .single para evitar crash)
        const { data: residentes, error } = await supabase
          .from('residentes')
          .select('*')
          .eq('telefono', senderPhone);

        if (error) {
          console.error("Error consultando Supabase:", error);
          return res.status(200).json({ status: 'Supabase error', error: error.message });
        }

        if (!residentes || residentes.length === 0) {
          console.log(`Teléfono no encontrado en Supabase: ${senderPhone}`);
          return res.status(200).json({ status: 'Unauthorized sender', phone: senderPhone });
        }

        const residente = residentes[0];
        const nombreResidente = residente.nombre || 'Residente';
        const casaResidente = residente.casa_lote || 'No especificada';

        let tipoAlerta = '';
        if (cleanCommand === 'M') tipoAlerta = 'Médica 🚑';
        if (cleanCommand === 'S') tipoAlerta = 'Seguridad / Asalto 🚨';
        if (cleanCommand === 'I') tipoAlerta = 'Incendio 🔥';
        if (cleanCommand === 'P') tipoAlerta = 'Pánico / General ⚠️';

        const respuestaTexto = `🚨 *ALERTA ACTIVADA* 🚨\n\n*Tipo:* ${tipoAlerta}\n*Reportado por:* ${nombreResidente}\n*Casa/Lote:* ${casaResidente}\n\n_El sistema ha registrado su aviso._`;

        // Enviar respuesta al grupo
        const evoResponse = await fetch(`${evolutionUrl}/message/sendText/${evolutionInstance}`, {
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

        const evoResult = await evoResponse.json();
        console.log("Respuesta de Evolution API al enviar:", evoResult);

        return res.status(200).json({ 
          status: 'Success', 
          command: cleanCommand, 
          residente: nombreResidente 
        });
      }
    }

    return res.status(200).json({ status: 'Event received, no action needed' });

  } catch (err) {
    console.error('Error crítico en el webhook:', err);
    return res.status(500).json({ error: err.message });
  }
}
