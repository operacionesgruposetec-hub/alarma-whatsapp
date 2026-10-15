import { ejecutarAlarmaVecinal } from '../services/tuyaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body;

    const remoteJid = body?.data?.key?.remoteJid || body?.data?.sender || '';
    const senderPn = body?.data?.pushName || 'Vecino';
    
    // ==========================================
    // EXTRACCIÓN INTELIGENTE DEL NÚMERO REAL
    // Buscamos en todas las propiedades del payload de Evolution API 
    // donde suele venir el número real antes de caer en el LID del grupo.
    // ==========================================
    let numeroRealEncontrado = '';

    // 1. Revisar si viene un número explícito en el autor o participante principal que no sea LID
    const possibleSources = [
      body?.data?.key?.participant,
      body?.data?.participant,
      body?.data?.sender,
      body?.data?.key?.remoteJid
    ];

    for (let source of possibleSources) {
      if (source && typeof source === 'string' && !source.includes('@lid')) {
        let cleaned = source.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
        // Un número real de teléfono válido suele tener entre 8 y 15 dígitos, 
        // a diferencia de los IDs de grupo o chats que son larguísimos.
        if (cleaned.length >= 8 && cleaned.length <= 15) {
          numeroRealEncontrado = cleaned;
          break;
        }
      }
    }

    // 2. Si no lo encontramos en las fuentes limpias, revisamos si el body trae metadatos del usuario
    if (!numeroRealEncontrado && body?.data?.author) {
      let cleanedAuthor = body.data.author.replace('@s.whatsapp.net', '').replace(/[^0-9]/g, '');
      if (cleanedAuthor.length >= 8 && cleanedAuthor.length <= 15) {
        numeroRealEncontrado = cleanedAuthor;
      }
    }

    // 3. Fallback final: Si de plano el payload solo trae el LID, 
    // tomamos cualquier número numérico que aparezca en el objeto que no sea el LID.
    if (!numeroRealEncontrado) {
      const rawString = JSON.stringify(body);
      // Buscamos patrones de números de teléfono en todo el JSON que parezcan números reales
      const matches = rawString.match(/"([0-9]{10,12})"/g);
      if (matches && matches.length > 0) {
        for (let m of matches) {
          let cleanMatch = m.replace(/"/g, '');
          if (!cleanMatch.startsWith('1203') && cleanMatch !== '103693412229282') { // Ignorar IDs de grupo o el LID conocido
            numeroRealEncontrado = cleanMatch;
            break;
          }
        }
      }
    }

    // Si todo falla, dejamos el campo limpio pero sin mandar el LID como teléfono de base de datos
    const telefonoRemitente = numeroRealEncontrado || '';

    console.log(`📱 Chat del Grupo: ${remoteJid} | 🎯 NÚMERO REAL EXTRAÍDO PARA GOOGLE SHEETS: ${telefonoRemitente}`);

    const messageText = body?.data?.message?.conversation || 
                        body?.data?.message?.extendedTextMessage?.text || '';

    const cleanText = messageText.trim().toUpperCase();
    const comandosValidos = ['M', 'S', 'I', 'P'];

    let datosResidente = null;

    if (comandosValidos.includes(cleanText) && telefonoRemitente !== '') {
      console.log(`🚨 Comando de alarma [${cleanText}] detectado. Cotejando número real con Google Sheets: ${telefonoRemitente}`);

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
    } else if (comandosValidos.includes(cleanText) && telefonoRemitente === '') {
      console.warn(`⚠️ Se detectó el comando [${cleanText}] pero no se pudo aislar un número de teléfono válido (se descartó el LID).`);
    }

    return res.status(200).json({ success: true, status: 'Webhook procesado' });

  } catch (error) {
    console.error('Error general en webhook.js:', error);
    return res.status(500).json({ error: error.message });
  }
}
