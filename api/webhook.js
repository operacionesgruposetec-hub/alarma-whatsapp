import { ejecutarAlarmaVecinal } from '../services/tuyaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body || {};
    
    // 1. Identificar el chat donde se responderá (si es grupo, responde al grupo; si es privado, al chat)
    const remoteJid = body?.data?.key?.remoteJid || body?.data?.sender || '';
    const senderPn = body?.data?.pushName || 'Vecino';
    
    // 2. Extracción robusta del emisor real (buscando en todas las rutas posibles de Evolution API para grupos y chats)
    const rawParticipant = body?.data?.key?.participant || 
                           body?.data?.participant || 
                           body?.data?.author || 
                           body?.data?.key?.remoteJid || '';

    // Limpieza profunda del número de teléfono
    let telefonoRemitente = rawParticipant.replace(/[^0-9]/g, '');

    // Opcional de seguridad: Si el número extraído del grupo incluye código de país o viene largo,
    // puedes asegurar que tome los dígitos correctos para que coincida con tu Google Sheet.
    console.log(`📱 Chat (remoteJid): ${remoteJid} | Emisor crudo: ${rawParticipant} | Teléfono limpio para búsqueda: ${telefonoRemitente}`);

    const messageText = body?.data?.message?.conversation || 
                        body?.data?.message?.extendedTextMessage?.text || '';

    const cleanText = messageText.trim().toUpperCase();
    const comandosValidos = ['M', 'S', 'I', 'P'];

    // Validamos si el mensaje es uno de los comandos de alarma
    if (comandosValidos.includes(cleanText)) {
      console.log(`🚨 Comando de alarma [${cleanText}] detectado de: ${telefonoRemitente}`);

      let datosResidente = null;
      try {
        const resultadoTuya = await ejecutarAlarmaVecinal(telefonoRemitente, cleanText);
        
        if (resultadoTuya.success && resultadoTuya.datosResidente) {
          datosResidente = resultadoTuya.datosResidente;
          console.log(`✅ Residente encontrado con éxito: ${datosResidente.nombre}`);
        } else {
          console.warn(`⚠️ Advertencia: ${resultadoTuya.error || 'No se pudieron obtener datos del residente'}`);
        }
      } catch (tuyaErr) {
        console.error("❌ Error crítico ejecutando servicio:", tuyaErr.message);
      }

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

      const nombreResidente = datosResidente?.nombre || senderPn;
      const domicilioResidente = datosResidente?.domicilio || 'Residencia Registrada';

      const respuestaTexto = `👤 SR/SRA: ${nombreResidente}\n` +
        `🏠 DOMICILIO: ${domicilioResidente}\n` +
        `📅 FECHA Y HORA: ${fechaHoraCR}\n\n` +
        `⚠️ ATENCION VECINOS (Alerta: ${cleanText}) ⚠️`;

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const instanceName = process.env.EVOLUTION_INSTANCE;
      const headers = {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_API_KEY
      };

      // 1. Enviar mensaje de texto (se responde al chat/grupo donde se emitió la alerta)
      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          text: respuestaTexto
        })
      });

      // 2. Enviar foto desde la hoja si está disponible
      if (datosResidente?.foto && datosResidente.foto.trim() !== "") {
        let directImageUrl = datosResidente.foto.trim();

        const driveMatch = directImageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || directImageUrl.match(/id=([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1]) {
          const driveFileId = driveMatch[1];
          directImageUrl = `https://lh3.googleusercontent.com/d/${driveFileId}`;
        }

        console.log(`🖼️ Intentando enviar foto a Evolution API: ${directImageUrl}`);

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
