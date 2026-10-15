import { ejecutarAlarmaVecinal } from '../services/tuyaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body;

    // 1. Identificar el chat donde se responderá (el grupo)
    const remoteJid = body?.data?.key?.remoteJid || body?.data?.sender || '';
    const senderPn = body?.data?.pushName || 'Vecino';
    
    // 2. Extracción estricta para evitar y BLOQUEAR el número 'lid'
    // Verificamos de dónde viene el emisor real
    let rawParticipant = body?.data?.key?.participant || body?.data?.participant || body?.data?.sender || remoteJid;

    // SI EL IDENTIFICADOR TRAE '@lid' O ES UN IDENTIFICADOR INTERNO DE WHATSAPP, LO DESCARTAMOS
    if (rawParticipant.includes('@lid') || rawParticipant.includes('lid')) {
      console.warn(`⚠️ Se detectó un identificador LID de WhatsApp (${rawParticipant}). Omitiéndolo para buscar el número real...`);
      // Forzamos buscar en el sender o en otro campo alternativo si está disponible, 
      // o limpiamos para asegurar que no se use el lid.
      rawParticipant = body?.data?.sender || '';
    }

    // Limpieza profunda del número de teléfono para quedarnos solo con los dígitos reales
    let telefonoRemitente = rawParticipant.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');

    // ADICIONAL: Si por alguna razón el teléfono resultante sigue siendo el LID (suele ser un número largo distinto a tu celular),
    // puedes poner aquí una validación o asegurarte de que tome el número correcto de tu chip.
    // Si tu número real tiene una cantidad específica de dígitos (ej: 8 dígitos en Costa Rica más código de país),
    // filtramos para asegurarnos de que la búsqueda se haga estrictamente con el número de teléfono físico.
    
    console.log(`📱 Chat: ${remoteJid} | Número real depurado para comparación: ${telefonoRemitente}`);

    const messageText = body?.data?.message?.conversation || 
                        body?.data?.message?.extendedTextMessage?.text || '';

    const cleanText = messageText.trim().toUpperCase();
    const comandosValidos = ['M', 'S', 'I', 'P'];

    let datosResidente = null;

    // Validamos si el mensaje es uno de los comandos de alarma y tenemos un número válido
    if (comandosValidos.includes(cleanText)) {
      console.log(`🚨 Comando de alarma [${cleanText}] detectado. Cotejando número real: ${telefonoRemitente}`);

      // ==========================================
      // DISPARAR EL HARDWARE DE TUYA SMART & GOOGLE SHEETS
      // ==========================================
      try {
        const resultadoTuya = await ejecutarAlarmaVecinal(telefonoRemitente, cleanText);
        if (resultadoTuya.success) {
          console.log(`✅ Tuya Cloud ejecutado con éxito: ${resultadoTuya.message}`);
          if (resultadoTuya.datosResidente) {
            datosResidente = resultadoTuya.datosResidente;
          }
        } else {
          console.warn(`⚠️ Advertencia de Tuya Service: ${resultadoTuya.error || resultadoTuya.message}`);
        }
      } catch (tuyaErr) {
        console.error("❌ Error crítico ejecutando Tuya Service:", tuyaErr.message);
      }

      // ==========================================
      // LÓGICA DE WHATSAPP (TEXTO Y FOTO)
      // ==========================================
      const optionsTime = { 
        timeZone: 'America/Costa_Rica', 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit', 
        hour12: true 
      };
      const fechaHoraCR = new Intl.DateTimeFormat('es-CR', optionsTime).format(new Date());

      const nombreResidente = datosResidente ? datosResidente.nombre : senderPn;
      const domicilioResidente = datosResidente ? datosResidente.domicilio : 'Residencia Registrada';

      const respuestaTexto = `👤 SR/SRA: ${nombreResidente}\n` +
        `🏠 DOMICILIO: ${domicilioResidente}\n` +
        `📅 FECHA Y HORA: ${fechaHoraCR}\n\n` +
        `⚠️ ATENCION VECINOS (Comando: ${cleanText}) ⚠️`;

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME;
      const headers = {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_API_KEY
      };

      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          text: respuestaTexto
        })
      });

      // Enviar foto desde la hoja
      if (datosResidente && datosResidente.foto && datosResidente.foto.trim() !== "") {
        let directImageUrl = datosResidente.foto.trim();

        const driveMatch = directImageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || directImageUrl.match(/id=([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1]) {
          const driveFileId = driveMatch[1];
          directImageUrl = `https://lh3.googleusercontent.com/d/${driveFileId}`;
        }

        try {
          await fetch(`${evolutionUrl}/message/sendMedia/${instanceName}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
              number: remoteJid,
              mediaMessage: {
                mediatype: "image",
                media: directImageUrl,
                caption: `🔴 FOTO DE LA CASA - ALARMA VECINAL (${cleanText}) 🔴`
              }
            })
          });
        } catch (mediaErr) {
          console.error("❌ Error enviando foto a Evolution API:", mediaErr.message);
        }
      }
    }

    return res.status(200).json({ success: true, status: 'Webhook procesado' });

  } catch (error) {
    console.error('Error general en webhook.js:', error);
    return res.status(500).json({ error: error.message });
  }
}
