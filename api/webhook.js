import { ejecutarAlarmaVecinal } from '../services/tuyaService.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const body = req.body;

    if (body.event === 'MESSAGES_UPSERT' || body.event === 'messages.upsert') {
      const messageData = body.data;

      if (messageData?.key?.fromMe) {
        return res.status(200).json({ status: 'Ignored: From me' });
      }

      const remoteJid = messageData?.key?.remoteJid || messageData?.remoteJid;
      const rawParticipant = messageData?.key?.participant || messageData?.participant || messageData?.sender || '';
      
      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 Mensaje recibido en grupo. Remitente bruto: [${rawParticipant}] -> Comando: [${cleanText}]`);

      // EXTRACCIÓN 100% LIMPIA Y GENÉRICA (Sin parches, sin números quemados)
      // Extrae la cadena antes del '@' (puede ser un número o un LID)
      const remitenteLimpio = rawParticipant.split('@')[0].split(':')[0].trim();

      console.log(`📊 Consultando Google Sheets con el identificador del remitente: [${remitenteLimpio}]`);

      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl) {
        try {
          const urlConsulta = `${sheetApiUrl}?telefono=${encodeURIComponent(remitenteLimpio)}`;
          console.log(`🌐 URL de consulta generada: ${urlConsulta}`);
          
          const response = await fetch(urlConsulta, { 
            method: 'GET', 
            redirect: 'follow' 
          });

          const rawText = await response.text();
          console.log(`📥 Respuesta cruda de Google Apps Script recibida:`, rawText);

          const data = JSON.parse(rawText);
          const fuenteResidente = data.residente || data;

          if (data && (data.encontrado === true || data.encontrado === "true") && fuenteResidente) {
            datosResidente = {
              nombre: fuenteResidente.nombre || fuenteResidente.Nombre || 'Vecino Registrado',
              domicilio: fuenteResidente.domicilio || fuenteResidente.Domicilio || fuenteResidente.direccion || 'Residencia Registrada',
              latitud: parseFloat(fuenteResidente.latitud || fuenteResidente.Latitud || 0),
              longitud: parseFloat(fuenteResidente.longitud || fuenteResidente.Longitud || 0),
              foto: fuenteResidente.foto || fuenteResidente.Foto || ''
            };
            console.log(`✅ ¡ÉXITO! Residente encontrado en la base de datos: [${datosResidente.nombre}] - [${datosResidente.domicilio}]`);
          } else {
            console.log(`⚠️ La hoja respondió pero el identificador no está autorizado:`, rawText);
          }
        } catch (sheetError) {
          console.error(`❌ Error crítico consultando Google Sheet:`, sheetError.message);
        }
      }

      if (!datosResidente) {
        console.log(`❌ Alerta detenida: El remitente [${remitenteLimpio}] no está registrado en la base de datos.`);
        return res.status(200).json({ status: 'Ignored: Not registered' });
      }

      // ==========================================
      // DISPARAR HARDWARE TUYA CLOUD (SIRENA)
      // ==========================================
      try {
        console.log(`🚨 Ejecutando Tuya Service para: [${remitenteLimpio}] con comando [${cleanText}]`);
        const resultadoTuya = await ejecutarAlarmaVecinal(remitenteLimpio, cleanText);
        if (resultadoTuya.success) {
          console.log(`✅ Tuya Cloud ejecutado con éxito: ${resultadoTuya.message}`);
        } else {
          console.warn(`⚠️ Advertencia de Tuya Service: ${resultadoTuya.error || resultadoTuya.message}`);
        }
      } catch (tuyaErr) {
        console.error("❌ Error crítico ejecutando Tuya Service:", tuyaErr.message);
      }

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // Hora exacta de Costa Rica
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

      let tituloAlerta = '⚠️ ATENCIÓN VECINOS ⚠️';
      if (cleanText === 'M') {
        tituloAlerta = '🚨 EMERGENCIA MÉDICA 🚨';
      } else if (cleanText === 'S') {
        tituloAlerta = '🚨 ALERTA DE SOSPECHOSO 🚨';
      } else if (cleanText === 'I') {
        tituloAlerta = '🔥 ALERTA DE INCENDIO 🔥';
      } else if (cleanText === 'P') {
        tituloAlerta = '🆘 BOTÓN / ALERTA DE PÁNICO 🆘';
      }

      const informacionAlerta = `${tituloAlerta}\n\n` +
        `👤 SR/SRA: ${datosResidente.nombre}\n` +
        `🏠 DOMICILIO: ${datosResidente.domicilio}\n` +
        `📅 FECHA Y HORA: ${fechaHoraCR}`;

      // 1. ENVIAR FOTO CON INFORMACIÓN COMO PIE DE FOTO
      if (datosResidente.foto && datosResidente.foto.trim() !== "") {
        let directImageUrl = datosResidente.foto.trim();
        
        const driveMatch = directImageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || directImageUrl.match(/id=([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1]) {
          const driveFileId = driveMatch[1];
          directImageUrl = `https://lh3.googleusercontent.com/d/${driveFileId}`;
        }

        try {
          const mediaPayload = {
            number: remoteJid,
            mediatype: "image",
            media: directImageUrl,
            caption: informacionAlerta
          };

          await fetch(`${evolutionUrl}/message/sendMedia/${instanceName}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(mediaPayload)
          });
        } catch (mediaErr) {
          console.error("❌ Error enviando foto con caption:", mediaErr.message);
          await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ number: remoteJid, text: informacionAlerta })
          });
        }
      } else {
        await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({ number: remoteJid, text: informacionAlerta })
        });
      }

      // 2. ENVIAR UBICACIÓN GPS ABAJO
      if (datosResidente.latitud && datosResidente.longitud) {
        await fetch(`${evolutionUrl}/message/sendLocation/${instanceName}`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            number: remoteJid,
            name: `${tituloAlerta}`,
            address: `Residencia: ${datosResidente.domicilio} - ${datosResidente.nombre}`,
            latitude: datosResidente.latitud,
            longitude: datosResidente.longitud
          })
        });
      }

      console.log('🎉 ¡SECUENCIA DE ALARMA COMPLETADA CON ÉXITO!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico general:', error);
    return res.status(500).json({ error: error.message });
  }
}
