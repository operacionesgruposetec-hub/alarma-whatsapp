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
      const isGroup = remoteJid && remoteJid.endsWith('@g.us');

      const rawParticipant = messageData?.key?.participant || messageData?.participant || messageData?.sender || '';
      
      const messageText = messageData?.message?.conversation || 
                          messageData?.message?.extendedTextMessage?.text || 
                          messageData?.body || '';

      const cleanText = messageText.trim().toUpperCase();

      if (!['M', 'S', 'I', 'P'].includes(cleanText)) {
        return res.status(200).json({ status: 'Omitted' });
      }

      console.log(`🎯 Mensaje recibido en grupo. Remitente bruto: [${rawParticipant}] -> Comando: [${cleanText}]`);

      let telefonoFinal = '';

      // Extracción limpia del número o aplicación del mapeo de prueba para tu LID
      telefonoFinal = rawParticipant.split('@')[0].split(':')[0].replace(/\D/g, '');

      if (rawParticipant.includes('103693412229282') || telefonoFinal.length < 8) {
        telefonoFinal = "50660301041";
        console.log(`💡 Teléfono real mapeado para la consulta: [${telefonoFinal}]`);
      }

      console.log(`📊 Consultando Google Sheets con el número real: [${telefonoFinal}]`);

      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl) {
        try {
          const urlConsulta = `${sheetApiUrl}?telefono=${encodeURIComponent(telefonoFinal)}`;
          console.log(`🌐 URL de consulta generada: ${urlConsulta}`);
          
          // FORZAMOS A SEGUIR LA REDIRECCIÓN DE GOOGLE APPS SCRIPT
          const response = await fetch(urlConsulta, { 
            method: 'GET', 
            redirect: 'follow' 
          });

          const rawText = await response.text();
          console.log(`📥 Respuesta cruda de Google Apps Script recibida:`, rawText);

          const data = JSON.parse(rawText);
          if (data && data.encontrado) {
            datosResidente = {
              nombre: data.nombre,
              domicilio: data.domicilio,
              latitud: parseFloat(data.latitud),
              longitud: parseFloat(data.longitud),
              foto: data.foto
            };
            console.log(`✅ ¡ÉXITO! Residente encontrado: [${datosResidente.nombre}]`);
          } else {
            console.log(`⚠️ La hoja respondió pero el número no hizo match o devolvió:`, rawText);
          }
        } catch (sheetError) {
          console.error(`❌ Error crítico consultando Google Sheet:`, sheetError.message);
        }
      }

      if (!datosResidente) {
        console.log(`❌ Alerta detenida: El número no fue autorizado por la hoja.`);
        return res.status(200).json({ status: 'Ignored: Not registered' });
      }

      // ==========================================
      // DISPARAR HARDWARE TUYA CLOUD (SIRENA)
      // ==========================================
      try {
        console.log(`🚨 Ejecutando Tuya Service para el número: [${telefonoFinal}] con comando [${cleanText}]`);
        const resultadoTuya = await ejecutarAlarmaVecinal(telefonoFinal, cleanText);
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

      // 1. ENVIAR TEXTO CON LOS DATOS DE LA HOJA
      const respuestaTexto = `👤 SR/SRA: ${datosResidente.nombre}\n` +
        `🏠 DOMICILIO: ${datosResidente.domicilio}\n` +
        `📅 FECHA Y HORA: ${new Date().toLocaleString()}\n\n` +
        `⚠️ ATENCION VECINOS (Comando: ${cleanText}) ⚠️`;

      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          number: remoteJid,
          text: respuestaTexto
        })
      });

      // 2. ENVIAR FOTO DESDE LA HOJA
      if (datosResidente.foto) {
        await fetch(`${evolutionUrl}/message/sendMedia/${instanceName}`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            number: remoteJid,
            mediaMessage: {
              mediatype: "image",
              media: datosResidente.foto,
              caption: `🔴 FOTO DE LA CASA - ALARMA VECINAL (${cleanText}) 🔴`
            }
          })
        });
      }

      // 3. ENVIAR UBICACIÓN GPS DESDE LA HOJA
      if (datosResidente.latitud && datosResidente.longitud) {
        await fetch(`${evolutionUrl}/message/sendLocation/${instanceName}`, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            number: remoteJid,
            name: `Ubicación - ${datosResidente.nombre}`,
            address: datosResidente.domicilio,
            latitude: datosResidente.latitud,
            longitude: datosResidente.longitud
          })
        });
      }

      console.log('🎉 ¡SECUENCIA DE ALARMA COMPLETADA! El bot ha respondido en el grupo y accionado Tuya.');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico general:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
}
