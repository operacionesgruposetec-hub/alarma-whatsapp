import axios from 'axios';

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
        const webAppUrl = process.env.GOOGLE_SHEET_API_URL;
        if (webAppUrl) {
          // 1. Consultar Apps Script unificado
          const response = await axios.get(`${webAppUrl}?telefono=${encodeURIComponent(telefonoRemitente)}`);
          const data = response.data;

          if (data && data.encontrado) {
            datosResidente = data.residente;
            const tuyaInfo = data.tuya;

            // 2. Disparar Tuya Cloud si existe configuración
            if (tuyaInfo && tuyaInfo.deviceId && tuyaInfo.credenciales) {
              const { clientId, clientSecret, region } = tuyaInfo.credenciales;
              const deviceId = tuyaInfo.deviceId;
              const baseUrl = region === 'eu' ? 'https://openapi.tuyaeu.com' : 'https://openapi.tuyaus.com';
              const timestamp = Date.now().toString();

              // Token Tuya
              const tokenUrl = `${baseUrl}/v1.0/token?grant_type=1`;
              const crypto = await import('crypto');
              const signForToken = crypto.createHmac('sha256', clientSecret)
                .update(clientId + timestamp)
                .digest('hex')
                .toUpperCase();

              const tokenResponse = await axios.get(tokenUrl, {
                headers: { client_id: clientId, sign: signForToken, t: timestamp, sign_method: 'HMAC-SHA256' }
              });

              if (tokenResponse.data && tokenResponse.data.success) {
                const accessToken = tokenResponse.data.result.access_token;
                const commandPayload = {
                  commands: [{ code: "switch_1", value: cleanText === 'M' || cleanText === 'S' }]
                };

                const actionUrl = `/v1.0/devices/${deviceId}/commands`;
                const tNew = Date.now().toString();
                const contentHash = crypto.createHash('sha256').update(JSON.stringify(commandPayload)).digest('hex');
                const stringToSign = ['POST', contentHash, '', actionUrl].join('\n');
                const str = clientId + accessToken + tNew + stringToSign;
                const signForAction = crypto.createHmac('sha256', clientSecret).update(str).digest('hex').toUpperCase();

                await axios.post(`${baseUrl}${actionUrl}`, commandPayload, {
                  headers: {
                    client_id: clientId,
                    access_token: accessToken,
                    sign: signForAction,
                    t: tNew,
                    sign_method: 'HMAC-SHA256',
                    'Content-Type': 'application/json'
                  }
                });
                console.log(`✅ Dispositivo Tuya ${deviceId} activado.`);
              }
            }
          }
        }
      } catch (err) {
        console.error("Error en proceso Tuya/Sheets:", err.message);
      }

      // 3. Enviar Respuesta por WhatsApp (Evolution API)
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

      await fetch(`${evolutionUrl}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ number: remoteJid, text: respuestaTexto })
      });

      // Enviar foto si la hay
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
    console.error('Error general:', error);
    return res.status(500).json({ error: error.message });
  }
}
