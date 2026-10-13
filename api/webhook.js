import { createClient } from '@supabase/supabase-js';

// Inicializar cliente de Supabase usando tus variables de entorno
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  // Solo aceptamos peticiones POST desde Evolution API
  if (req.method !== 'POST') {
    return res.status(405.json({ error: 'Método no permitido' }));
  }

  try {
    const body = req.body;

    // Verificamos que sea un evento de mensaje entrante (MESSAGES_UPSERT)
    if (body.event === 'MESSAGES-UPSERT' || body.event === 'messages.upsert') {
      const messageData = body.data;
      
      // Extraer información clave del mensaje
      const remoteJid = messageData?.key?.remoteJid; // Identifica si es un grupo (termina en @g.us) o chat individual
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');
      
      // Si no es un grupo, ignoramos el mensaje (según la regla de seguridad comunitaria)
      if (!isGroup) {
        return res.status(200).json({ status: 'Ignored: Not a group message' });
      }

      // Obtener el número de teléfono del remitente real dentro del grupo
      // En Evolution API, el participante a menudo viene en messageData.key.participant o messageData.participant
      const participantJid = messageData?.key?.participant || messageData?.participant || '';
      const senderPhone = participantJid.split('@')[0]; // Limpiamos para dejar solo los números

      // Extraer el texto del mensaje (puede venir en diferentes estructuras según la versión de Evolution)
      const messageContent = 
        messageData?.message?.conversation ||
        messageData?.message?.extendedTextMessage?.text ||
        '';

      const cleanCommand = messageContent.trim().toUpperCase();

      // Validar si el texto es exactamente uno de nuestros comandos de emergencia: M, S, I, P
      const validCommands = ['M', 'S', 'I', 'P'];
      if (validCommands.includes(cleanCommand)) {
        console.log(`Comando válido [${cleanCommand}] recibido del número ${senderPhone} en el grupo ${remoteJid}`);

        // Consultar Supabase para identificar al residente por su número de teléfono
        const { data: residente, error } = await supabase
          .from('residentes')
          .select('*, residenciales(*)')
          .eq('telefono', senderPhone)
          .single();

        if (error || !residente) {
          console.log(`Número no registrado en Supabase: ${senderPhone}`);
          // Opcional: Enviar mensaje al grupo indicando que el número no está autorizado
          return res.status(200).json({ status: 'Unauthorized sender' });
        }

        // Si el residente existe, armamos la respuesta con su información
        const nombreResidente = residente.nombre || 'Residente';
        const casaResidente = residente.casa_lote || 'No especificada';
        
        let tipoAlerta = '';
        if (cleanCommand === 'M') tipoAlerta = 'Médica 🚑';
        if (cleanCommand === 'S') tipoAlerta = 'Seguridad / Asalto 🚨';
        if (cleanCommand === 'I') tipoAlerta = 'Incendio 🔥';
        if (cleanCommand === 'P') tipoAlerta = 'Pánico / General ⚠️';

        const respuestaTexto = `🚨 *ALERTA ACTIVADA* 🚨\n\n*Tipo:* ${tipoAlerta}\n*Reportado por:* ${nombreResidente}\n*Casa/Lote:* ${casaResidente}\n\n_El sistema ha registrado su aviso._`;

        // Aquí más adelante integraremos el envío de mensaje de vuelta a través de Evolution API y la activación de Tuya
        
        return res.status(200).json({ 
          status: 'Success', 
          command: cleanCommand, 
          residente: nombreResidente,
          group: remoteJid 
        });
      }
    }

    return res.status(200).json({ status: 'Event received, no action needed' });

  } catch (err) {
    console.error('Error procesando el webhook:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
