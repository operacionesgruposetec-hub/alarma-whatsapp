import { ejecutarAlarmaVecinal } from '../services/tuyaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body || {};
    
    // 1. Identificar el chat donde se responderá (el grupo)
    const remoteJid = body?.data?.key?.remoteJid || body?.data?.sender || '';
    const senderPn = body?.data?.pushName || 'Vecino';
    
    // 2. Extracción correcta: Si el participant o sender trae '@lid', 
    // ignoramos ese identificador interno y buscamos el número real de teléfono.
    let rawParticipant = body?.data?.key?.participant || body?.data?.participant || body?.data?.sender || remoteJid;
    
    if (rawParticipant.includes('@lid') || rawParticipant.includes('g.us')) {
      // Si estamos en un grupo y viene el LID, el número real a veces viene en el author o debemos parsearlo.
      // Si Evolution API te pasa el número en otro campo, lo apuntamos aquí:
      rawParticipant = body?.data?.sender || body?.data?.key?.remoteJid || rawParticipant;
    }

    // Limpieza profunda para quedarnos únicamente con los dígitos del número de teléfono real
    let telefonoRemitente = rawParticipant.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');

    // Si por alguna razón sigue tomando un número muy corto o el LID, 
    // asegurémonos de extraer el número de teléfono limpio omitiendo el identificador de grupo (@g.us) o lid.
    if (telefonoRemitente.length > 15 || rawParticipant.includes('@lid')) {
      // Forzamos la limpieza extrayendo los dígitos limpios si están disponibles en el payload
      const fallbackNumber = body?.data?.key?.remoteJid || '';
      telefonoRemitente = fallbackNumber.replace(/[^0-9]/g, '');
    }

    console.log(`📱 Chat (remoteJid): ${remoteJid} | Participante analizado: ${rawParticipant} | Teléfono real para búsqueda: ${telefonoRemitente}`);

    const messageText = body?.data?.message?.conversation || 
                        body?.data?.message?.extendedTextMessage?.text || '';

    const cleanText = messageText.trim().toUpperCase();
    const comandosValidos = ['M', 'S', 'I', 'P'];

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
        `⚠️ ATENCION VECINOS (Comando: ${cleanText}) ⚠️`;

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const instanceName = process.env.EVOLUTION_INSTANCE;
      const headers = {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_API_KEY
      };

      // Enviar mensaje de texto al grupo
      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          text: respuestaTexto
        })
      });

      // Enviar foto si el residente tiene una registrada
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
