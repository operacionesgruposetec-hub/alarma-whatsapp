import { ejecutarAlarmaVecinal } from '../services/tuyaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body || {};
    const remoteJid = body?.data?.key?.remoteJid || body?.data?.sender || '';
    const senderPn = body?.data?.pushName || 'Vecino';
    
    const telefonoRemitente = remoteJid.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
    const messageText = body?.data?.message?.conversation || body?.data?.message?.extendedTextMessage?.text || '';
    const cleanText = messageText.trim().toUpperCase();
    const comandosValidos = ['M', 'S', 'I', 'P'];

    if (comandosValidos.includes(cleanText)) {
      console.log(`🚨 Comando [${cleanText}] detectado de: ${telefonoRemitente}`);

      let datosResidente = null;
      try {
        const resultadoTuya = await ejecutarAlarmaVecinal(telefonoRemitente, cleanText);
        if (resultadoTuya.success && resultadoTuya.datosResidente) {
          datosResidente = resultadoTuya.datosResidente;
        }
      } catch (err) {
        console.error("Error en servicio:", err.message);
      }

      const optionsTime = { timeZone: 'America/Costa_Rica', hour12: true };
      const fechaHoraCR = new Intl.DateTimeFormat('es-CR', optionsTime).format(new Date());

      const nombreResidente = datosResidente?.nombre || senderPn;
      const domicilioResidente = datosResidente?.domicilio || 'Residencia Registrada';

      const respuestaTexto = `👤 SR/SRA: ${nombreResidente}\n` +
        `🏠 DOMICILIO: ${domicilioResidente}\n` +
        `📅 FECHA Y HORA: ${fechaHoraCR}\n\n` +
        `⚠️ ATENCION VECINOS (Comando: ${cleanText}) ⚠️`;

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const instanceName = process.env.EVOLUTION_INSTANCE;
      const headers = { 'Content-Type': 'application/json', 'apikey': process.env.EVOLUTION_API_KEY };

      // Enviar mensaje de texto
      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ number: remoteJid, text: respuestaTexto })
      });

      // Enviar foto si existe
      if (datosResidente?.foto && datosResidente.foto.trim() !== "") {
        let directImageUrl = datosResidente.foto.trim();
        const driveMatch = directImageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || directImageUrl.match(/id=([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1]) {
          directImageUrl = `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
        }

        try {
          await fetch(`${evolutionUrl}/message/sendMedia/${instanceName}`, {
            method: 'POST',
            headers,
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
          console.error("Error enviando foto:", mediaErr.message);
        }
      }
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error en webhook:', error);
    return res.status(500).json({ error: error.message });
  }
}
