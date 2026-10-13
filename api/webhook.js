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

      // Extraer el texto del mensaje de forma segura
      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || '';

      // Obtener el número de teléfono del emisor de manera limpia
      const participantJid = messageData?.key?.participant || messageData?.participant || messageData?.key?.remoteJid || '';
      let rawPhone = participantJid.split('@')[0];
      
      // Limpiar caracteres extra si los trae (ej. de grupos de WhatsApp)
      rawPhone = rawPhone.replace(/[^0-9]/g, '');

      // Construir formato con + (Ej: +50660301041). Ajusta los últimos dígitos según tu país si es necesario, 
      // o probemos buscando directamente por coincidencia parcial si el número completo varía.
      const senderPhone = '+' + rawPhone;

      console.log(`Texto extraído: "${messageText}" | Teléfono procesado para buscar: ${senderPhone}`);

      // Activación al recibir 'M' o 'S'
      if (messageText.trim().toUpperCase() === 'M' || messageText.trim().toUpperCase() === 'S') {
        
        // Consultar el residente en Supabase
        const { data: residente, error } = await supabase
          .from('residentes')
          .select('*, residenciales(*)')
          .eq('teléfono', senderPhone)
          .single();

        if (error || !residente) {
          console.error('Error o residente no encontrado en Supabase para:', senderPhone, error);
          return res.status(200).json({ status: 'Residente no registrado' });
        }

        console.log('Residente encontrado:', residente.nombre);

        const nombreResidente = residente.nombre || 'Desconocido';
        const domicilio = residente.domicilio || 'No especificado';

        // 1. ENVIAR IMAGEN
        const imagenUrl = "https://images.unsplash.com/photo-1541872703-74c5e44368f9?q=80&w=1000&auto=format&fit=crop";
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
          { headers: { apikey: evolutionKey, 'Content-Type': 'application/json' } }
        );

        // 2. ENVIAR TEXTO
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
          { headers: { apikey: evolutionKey, 'Content-Type': 'application/json' } }
        );

        // 3. ENVIAR UBICACIÓN
        await axios.post(
          `${evolutionUrl}/message/sendLocation/${evolutionInstance}`,
          {
            number: remoteJid,
            name: `Ubicación de Emergencia - ${nombreResidente}`,
            address: domicilio,
            latitude: residente.latitud || 9.856,
            longitude: residente.longitud || -83.914
          },
          { headers: { apikey: evolutionKey, 'Content-Type': 'application/json' } }
        );

        console.log('¡Secuencia de alerta enviada con éxito!');
      }
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('Error general en el webhook:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
