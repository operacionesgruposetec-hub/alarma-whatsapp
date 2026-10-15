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

      let identificadorBuscado = rawParticipant.split('@')[0].split(':')[0].trim();
      let telefonoFinal = '';

      const evolutionUrl = process.env.EVOLUTION_API_URL;
      const evolutionKey = process.env.EVOLUTION_API_KEY;
      const instanceName = process.env.EVOLUTION_INSTANCE_NAME || 'residencial-api';

      const headers = {
        'apikey': evolutionKey,
        'Content-Type': 'application/json'
      };

      // =========================================================================
      // PASO 1: TRADUCCIÓN INTELIGENTE DE LID MEDIANTE EVOLUTION API (SI APLICA)
      // =========================================================================
      if (rawParticipant.includes('@lid') || identificadorBuscado.length > 11) {
        console.log(`🔍 El remitente es un LID. Consultando participantes del grupo [${remoteJid}] para resolver el número real...`);
        try {
          // Endpoint oficial de Evolution API para obtener los participantes del grupo
          const groupParticipantsUrl = `${evolutionUrl}/group/participants/${instanceName}?groupId=${encodeURIComponent(remoteJid)}`;
          const groupRes = await fetch(groupParticipantsUrl, { method: 'GET', headers: headers });
          const groupData = await groupRes.json();

          // Buscamos dentro de los participantes del grupo el objeto que coincida con este LID
          if (Array.isArray(groupData)) {
            const participanteEncontrado = groupData.find(p => 
              (p.id && p.id.includes(identificadorBuscado)) || 
              (p.lid && p.lid.includes(identificadorBuscado)) ||
              (p.participant && p.participant.includes(identificadorBuscado))
            );

            if (participanteEncontrado) {
              // Extraemos el número real (id o number) del participante del grupo
              const idReal = participanteEncontrado.id || participanteEncontrado.participant || '';
              telefonoFinal = idReal.split('@')[0].split(':')[0].replace(/\D/g, '');
              console.log(`💡 ¡LID traducido exitosamente a teléfono real!: [${telefonoFinal}]`);
            }
          }
        } catch (evoErr) {
          console.warn(`⚠️ No se pudo consultar los participantes del grupo en Evolution API:`, evoErr.message);
        }
      }

      // Si no era LID o la traducción falló, usamos el identificador directo limpio
      if (!telefonoFinal || telefonoFinal.length < 8) {
        telefonoFinal = identificadorBuscado.replace(/\D/g, '');
      }

      // Parche de prueba temporal opcional (si tu número personal sigue requiriéndolo para pruebas rápidas)
      if (rawParticipant.includes('103693412229282') || identificadorBuscado === '103693412229282') {
        telefonoFinal = "50660301041";
      }

      console.log(`📊 Consultando Google Sheets con el número final: [${telefonoFinal}] (o LID original: [${identificadorBuscado}])`);

      const sheetApiUrl = process.env.GOOGLE_SHEET_API_URL;
      let datosResidente = null;

      if (sheetApiUrl) {
        // Consultamos tanto por el teléfono traducido como por el identificador original por si acaso
        const urlsAConsultar = [
          `${sheetApiUrl}?telefono=${encodeURIComponent(telefonoFinal)}`,
          `${sheetApiUrl}?telefono=${encodeURIComponent(identificadorBuscado)}`
        ];

        for (const urlConsulta of urlsAConsultar) {
          try {
            console.log(`🌐 Probando URL de consulta: ${urlConsulta}`);
            const response = await fetch(urlConsulta, { method: 'GET', redirect: 'follow' });
            const rawText = await response.text();
            
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
              console.log(`✅ ¡ÉXITO! Residente encontrado: [${datosResidente.nombre}] - [${datosResidente.domicilio}]`);
              break; // Encontrado, salimos del ciclo
            }
          } catch (sheetError) {
            console.error(`❌ Error en intento de consulta a Google Sheet:`, sheetError.message);
          }
        }
      }

      if (!datosResidente) {
        console.log(`❌ Alerta detenida: El remitente no fue autorizado por la hoja.`);
        return res.status(200).json({ status: 'Ignored: Not registered' });
      }

      // ==========================================
      // DISPARAR HARDWARE TUYA CLOUD (SIRENA)
      // ==========================================
      try {
        console.log(`🚨 Ejecutando Tuya Service para: [${telefonoFinal}] con comando [${cleanText}]`);
        const resultadoTuya = await ejecutarAlarmaVecinal(telefonoFinal, cleanText);
        if (resultadoTuya.success) {
          console.log(`✅ Tuya Cloud ejecutado con éxito: ${resultadoTuya.message}`);
        } else {
          console.warn(`⚠️ Advertencia de Tuya Service: ${resultadoTuya.error || resultadoTuya.message}`);
        }
      } catch (tuyaErr) {
        console.error("❌ Error crítico ejecutando Tuya Service:", tuyaErr.message);
      }

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

      console.log('🎉 ¡SECUENCIA DE ALARMA INTELIGENTE COMPLETADA!');
    }

    return res.status(200).json({ status: 'Webhook procesado correctamente' });

  } catch (error) {
    console.error('❌ Error crítico general:', error);
    return res.status(500).json({ error: error.message });
  }
}
