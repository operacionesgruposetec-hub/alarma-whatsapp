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

      console.log(`🎯 Mensaje recibido. Grupo origen: [${remoteJid}] | Remitente: [${rawParticipant}] -> Comando: [${cleanText}]`);

      // 1. Extracción original de tu código (intacta y sin tocar)
      let identificadorRemitente = '';
      if (rawParticipant) {
        identificadorRemitente = rawParticipant.split('@')[0].split(':')[0].trim();
      } else {
        identificadorRemitente = remoteJid.split('@')[0].split(':')[0].trim();
      }

      console.log(`📊 Consultando Google Sheets con el identificador: [${identificadorRemitente}]`);

      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;
      let grupoAutorizadoHoja = null;

      if (sheetApiUrl) {
        try {
          const urlConsulta = `${sheetApiUrl}?identificador=${encodeURIComponent(identificadorRemitente)}&grupo=${encodeURIComponent(remoteJid)}`;
          const response = await fetch(urlConsulta, { method: 'GET', redirect: 'follow' });
          const rawText = await response.text();
          
          const data = JSON.parse(rawText);
          grupoAutorizadoHoja = data.grupoAutorizado || data.grupoOficial || null;

          const fuenteResidente = data.residente || data;

          if (data && (data.encontrado === true || data.encontrado === "true") && fuenteResidente && fuenteResidente.nombre) {
            datosResidente = {
              nombre: fuenteResidente.nombre || 'Vecino Registrado',
              domicilio: fuenteResidente.domicilio || fuenteResidente.direccion || 'Residencia Registrada',
              latitud: parseFloat(fuenteResidente.latitud || 0),
              longitud: parseFloat(fuenteResidente.longitud || 0),
              foto: fuenteResidente.foto || ''
            };
            console.log(`✅ ¡ÉXITO! Residente encontrado en Sheets: [${datosResidente.nombre}]`);
          }
        } catch (sheetError) {
          console.error(`❌ Error consultando Google Sheet:`, sheetError.message);
        }
      }

      // 2. VALIDACIÓN DE SEGURIDAD ESTRICTA POR GRUPO (Columna E)
      if (grupoAutorizadoHoja && remoteJid !== grupoAutorizadoHoja) {
        console.log(`❌ Alerta detenida: El grupo [${remoteJid}] no coincide con la Columna E [${grupoAutorizadoHoja}].`);
        return res.status(200).json({ status: 'Ignored: Unauthorized group' });
      }

      // 3. RESPALDO INTELIGENTE
      if (!datosResidente) {
        console.log(`⚠️ El LID [${identificadorRemitente}] aún no está en la hoja, pero el grupo es válido. Usando perfil temporal.`);
        datosResidente = {
          nombre: `Vecino (ID: ${identificadorRemitente.slice(-4)})`,
          domicilio: 'Residencia Autorizada en Grupo',
          latitud: 9.9355,   
          longitud: -84.0907,
          foto: ''           
        };
      }

      // 4. DISPARAR HARDWARE TUYA CLOUD (SIRENA)
      try {
        await ejecutarAlarmaVecinal(identificadorRemitente, cleanText);
      } catch (tuyaErr) {
        console.error("❌ Error ejecutando Tuya Service:", tuyaErr.message);
      }

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      const optionsTime = { 
        timeZone: 'America/Costa_Rica', 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true 
      };
      const fechaHoraCR = new Intl.DateTimeFormat('es-CR', optionsTime).format(new Date());

      let tituloAlerta = '⚠️ ATENCIÓN VECINOS ⚠️';
      if (cleanText === 'M') tituloAlerta = '🚨 EMERGENCIA MÉDICA 🚨';
      else if (cleanText === 'S') tituloAlerta = '🚨 ALERTA DE SOSPECHOSO 🚨';
      else if (cleanText === 'I') tituloAlerta = '🔥 ALERTA DE INCENDIO 🔥';
      else if (cleanText === 'P') tituloAlerta = '🆘 BOTÓN / ALERTA DE PÁNICO 🆘';

      const informacionAlerta = `${tituloAlerta}\n\n` +
        `👤 SR/SRA: ${datosResidente.nombre}\n` +
        `🏠 DOMICILIO: ${datosResidente.domicilio}\n` +
        `📅 FECHA Y HORA: ${fechaHoraCR}`;

      // 5. ENVIAR FOTO O TEXTO
      if (datosResidente.foto && datosResidente.foto.trim() !== "") {
        let directImageUrl = datosResidente.foto.trim();
        const driveMatch = directImageUrl.match(/\/d\/([a-zA-Z0-9_-]+)/) || directImageUrl.match(/id=([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1]) {
          directImageUrl = `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
        }

        try {
          await fetch(`${evolutionUrl}/message/sendMedia/${instanceName}`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ number: remoteJid, mediatype: "image", media: directImageUrl, caption: informacionAlerta })
          });
        } catch (e) {
          await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
            method: 'POST', headers: headers,
            body: JSON.stringify({ number: remoteJid, text: informacionAlerta })
          });
        }
      } else {
        await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
          method: 'POST', headers: headers,
          body: JSON.stringify({ number: remoteJid, text: informacionAlerta })
        });
      }

      // 6. ENVIAR UBICACIÓN GPS
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

      // =========================================================================
      // 🚀 7. REENVÍO SILENCIOSO AL NUEVO RCA (Sin tocar la lógica de arriba)
      // =========================================================================
      try {
        await fetch('https://monitoringplatform.vercel.app/api/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source: 'whatsapp',
            message: cleanText,
            abonadoId: identificadorRemitente || 'ABS-WHATSAPP',
            description: `Alerta ${cleanText} de ${datosResidente.nombre} (${datosResidente.domicilio})`,
            coordinates: { lat: datosResidente.latitud, lng: datosResidente.longitud },
            rawData: body
          })
        });
      } catch (forwardErr) {
        console.error('⚠️ Error en reenvío secundario:', forwardErr.message);
      }
      // =========================================================================

      console.log('🎉 ¡SECUENCIA DE ALARMA COMPLETADA CON ÉXITO!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico general:', error);
    return res.status(500).json({ error: error.message });
  }
}
