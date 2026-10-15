import { ejecutarAlarmaVecinal } from '../services/tuyaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body || {};
    
    // 1. Identificar el chat donde se responderá (si es grupo, se responde al grupo; si es privado, al chat)
    const remoteJid = body?.data?.key?.remoteJid || body?.data?.sender || '';
    
    // 2. Extraer el número real del emisor (incluso si está dentro de un grupo)
    // Evolution API suele enviar el emisor real del grupo en key.participant o participant
    const rawParticipant = body?.data?.key?.participant || body?.data?.participant || remoteJid;
    const telefonoRemitente = rawParticipant.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');

    const senderPn = body?.data?.pushName || 'Vecino';
    
    const messageText = body?.data?.message?.conversation || body?.data?.message?.extendedTextMessage?.text || '';
    const cleanText = messageText.trim().toUpperCase();
    const comandosValidos = ['M', 'S', 'I', 'P'];

    console.log(`📱 Chat/Grupo (remoteJid): ${remoteJid} | Emisor real extraído: ${telefonoRemitente} | Comando: ${cleanText}`);

    if (comandosValidos.includes(cleanText)) {
      let datosResidente = null;
      try {
        const resultadoTuya = await ejecutarAlarmaVecinal(telefonoRemitente, cleanText);
        
        if (resultadoTuya.success && resultadoTuya.datosResidente) {
          datosResidente = resultadoTuya.datosResidente;
          console.log(`✅ Residente encontrado: ${datosResidente.nombre}`);
        } else {
          console.warn(`⚠️ No se encontró el residente con el teléfono: ${telefonoRemitente}`);
        }
      } catch (tuyaErr) {
        console.error("❌ Error ejecutando servicio:", tuyaErr.message);
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
        `⚠️ ATENCION VECINOS (ALERTA: ${cleanText}) ⚠️`;

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const instanceName = process.env.EVOLUTION_INSTANCE;
      const headers = {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_API_KEY
      };

      // Nota: Usamos remoteJid para que la respuesta y la foto lleguen al grupo donde se mandó el comando
      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          text: respuestaTexto
        })
      });

      // Enviar foto al grupo si el residente tiene una registrada
      if (datosResidente?.foto && datosResidente.foto.trim() !== "") {
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
