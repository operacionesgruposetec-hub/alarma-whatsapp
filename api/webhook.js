import { ejecutarAlarmaVecinal } from '../services/tuyaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body;

    // 1. Extracción de datos básicos del mensaje y remitente de Evolution API (TAL CUAL TU CÓDIGO ORIGINAL)
    const remoteJid = body?.data?.key?.remoteJid || body?.data?.sender || '';
    const senderPn = body?.data?.pushName || 'Vecino';
    
    // Limpieza del número de teléfono del emisor para usarlo en la búsqueda
    const telefonoRemitente = remoteJid.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');

    const messageText = body?.data?.message?.conversation || 
                        body?.data?.message?.extendedTextMessage?.text || '';

    const cleanText = messageText.trim().toUpperCase();
    const comandosValidos = ['M', 'S', 'I', 'P'];

    // Variable para los datos del residente
    let datosResidente = null;

    // Validamos si el mensaje es uno de los comandos de alarma
    if (comandosValidos.includes(cleanText)) {
      console.log(`🚨 Comando de alarma [${cleanText}] detectado de: ${telefonoRemitente}`);

      // ==========================================
      // DISPARAR EL HARDWARE DE TUYA SMART
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
      // LÓGICA EXISTENTE DE WHATSAPP (TEXTO Y FOTO)
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

      // Variables de entorno de tu instancia de Evolution
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

      // 2. ENVIAR FOTO DESDE LA HOJA (Asegurando compatibilidad con Evolution API)
      if (datosResidente && datosResidente.foto && datosResidente.foto.trim() !== "") {
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
