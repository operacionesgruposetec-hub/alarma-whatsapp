import { ejecutarAlarmaVecinal } from '../services/tuyaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body || {};
    
    // 1. Identificar el chat del grupo para responder ahí mismo
    const remoteJid = body?.data?.key?.remoteJid || '';
    const senderPn = body?.data?.pushName || 'Vecino';
    
    // 2. Extraer de manera infalible el emisor real ignorando si es un grupo (@g.us) o un LID (@lid)
    // En Evolution API, el participante real en un grupo viene en data.key.participant o data.participant
    let rawSender = body?.data?.key?.participant || 
                    body?.data?.participant || 
                    body?.data?.sender || 
                    remoteJid;

    // Si el rawSender sigue siendo el grupo o un lid, buscamos si hay otro campo de autor/remitente
    if (rawSender.includes('@g.us') || rawSender.includes('@lid')) {
      rawSender = body?.data?.sender || body?.data?.author || body?.data?.key?.participant || '';
    }

    // Limpieza profunda para quedarnos estrictamente con los números del teléfono real
    let telefonoRemitente = rawSender.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');

    // Si por alguna razón el número extraído sigue siendo el ID del grupo (que empieza con 12036...),
    // lo filtramos para que no busque eso en la hoja de Google Sheets.
    if (telefonoRemitente.startsWith('12036') || telefonoRemitente.length < 8) {
      console.warn(`⚠️ Advertencia: Se detectó un ID de grupo o inválido (${telefonoRemitente}). Buscando alternativas en el payload...`);
      // Intento alternativo buscando en pushName o ignorando si es el grupo
      telefonoRemitente = ''; 
    }

    console.log(`📱 Chat del Grupo: ${remoteJid} | Remitente crudo: ${rawSender} | Teléfono real depurado: ${telefonoRemitente}`);

    const messageText = body?.data?.message?.conversation || 
                        body?.data?.message?.extendedTextMessage?.text || '';

    const cleanText = messageText.trim().toUpperCase();
    const comandosValidos = ['M', 'S', 'I', 'P'];

    if (comandosValidos.includes(cleanText) && telefonoRemitente !== '') {
      console.log(`🚨 Comando de alarma [${cleanText}] procesando para el teléfono: ${telefonoRemitente}`);

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
        `⚠️ ATENCION VECINOS (Comando: ${cleanText}) ⚠️`;

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const instanceName = process.env.EVOLUTION_INSTANCE;
      const headers = {
        'Content-Type': 'application/json',
        'apikey': process.env.EVOLUTION_API_KEY
      };

      // Enviar texto al grupo
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
    } else {
      console.log("ℹ️ Mensaje ignorado: No es un comando válido o el teléfono del emisor no pudo ser determinado.");
    }

    return res.status(200).json({ success: true, status: 'Webhook procesado' });

  } catch (error) {
    console.error('Error general en webhook.js:', error);
    return res.status(500).json({ error: error.message });
  }
}
