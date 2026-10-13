// api/webhook.js

export default async function handler(req, res) {
  // 1. Asegurar que sea una petición POST (que es como manda los webhooks la Evolution API)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido. Solo POST.' });
  }

  try {
    const body = req.body;

    // Extraer datos del mensaje entrante de la Evolution API
    const messageData = body?.data?.message || body?.message;
    const senderJid = body?.data?.key?.remoteJid || body?.key?.remoteJid;
    const isFromMe = body?.data?.key?.fromMe || false;

    // Si no hay mensaje o el mensaje fue enviado por el propio bot/sistema, ignorar
    if (!messageData || isFromMe) {
      return res.status(200).json({ status: 'ignored_self_or_empty' });
    }

    // Extraer el texto del mensaje (soporta texto plano o mensajes extendidos)
    const rawText = messageData?.conversation || messageData?.extendedTextMessage?.text || '';
    
    // FILTRO ANTI-FALLOS: 
    // Limpiamos espacios y convertimos a mayúsculas. 
    // Exigimos que el mensaje sea EXACTAMENTE un solo caracter (M, S, I o P).
    const cleanText = rawText.trim().toUpperCase();
    const VALID_COMMANDS = ['M', 'S', 'I', 'P'];

    if (!VALID_COMMANDS.includes(cleanText)) {
      // Si el usuario escribió una frase ("Hola", "Mamá", "Buenos días"), 
      // el sistema la ignora por completo para evitar falsas alarmas.
      return res.status(200).json({ status: 'ignored_not_a_strict_command' });
    }

    // Mapa oficial de las alertas residenciales
    const ALERT_TYPES = {
      M: { code: 'M', name: 'Emergencia Médica', icon: '🚨' },
      S: { code: 'S', name: 'Sospecha', icon: '👁️' },
      I: { code: 'I', name: 'Incendio', icon: '🔥' },
      P: { code: 'P', name: 'Pánico', icon: '⚠️' }
    };

    const currentAlert = ALERT_TYPES[cleanText];

    console.log(`[ALERTA RECIBIDA] Tipo: ${currentAlert.name} (${currentAlert.code}) de: ${senderJid}`);

    // Próximos pasos a integrar aquí mismo en Vercel:
    // 1. Consultar Supabase usando el número (senderJid) para obtener la casa, el nombre, foto y coordenadas.
    // 2. Enviar la orden a la API de Tuya Smart para activar el socket/sirena correspondiente.
    // 3. Responder al residente por WhatsApp mediante la Evolution API.

    return res.status(200).json({
      success: true,
      message: `Comando ${currentAlert.code} procesado correctamente`,
      alert: currentAlert.name,
      sender: senderJid
    });

  } catch (error) {
    console.error('Error procesando el webhook en Vercel:', error);
    return res.status(500).json({ error: 'Error interno en el servidor' });
  }
}
