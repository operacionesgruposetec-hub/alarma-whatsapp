import axios from 'axios';
import crypto from 'crypto';

const TUYA_CLIENT_ID = '33v9xxh5vmvs3arqm8vj';
const TUYA_SECRET_KEY = 'd725d7c48f9d4b34a87901aba4bdf935';
const TUYA_BASE_URL = 'https://openapi.tuyaeu.com';

export async function ejecutarAlarmaVecinal(telefono, comando) {
  try {
    const webAppUrl = process.env.GOOGLE_SHEET_API_URL;
    if (!webAppUrl) {
      throw new Error("La variable de entorno GOOGLE_SHEET_API_URL no está configurada.");
    }

    const response = await axios.get(`${webAppUrl}?telefono=${encodeURIComponent(telefono)}`);
    const data = response.data;

    if (!data || !data.encontrado) {
      return { success: false, error: data.error || "Residente no encontrado en la base de datos." };
    }

    const residente = data.residente;
    const deviceId = data.tuyaDeviceId || data.deviceId;

    if (!deviceId) {
      console.warn("⚠️ No se encontró un Device ID de Tuya en la pestaña RESIDENCIALES.");
      return { success: true, message: "Alerta enviada, pero sin dispositivo Tuya asociado." };
    }

    try {
      const timestamp = Date.now().toString();

      // Firma correcta para el Token en Tuya Cloud v1.0
      // String to sign para GET /v1.0/token?grant_type=1:
      // client_id + timestamp
      const signStr = TUYA_CLIENT_ID + timestamp;
      const signForToken = crypto
        .createHmac('sha256', TUYA_SECRET_KEY)
        .update(signStr)
        .digest('hex')
        .toUpperCase();

      const tokenUrl = `${TUYA_BASE_URL}/v1.0/token?grant_type=1`;
      const tokenResponse = await axios.get(tokenUrl, {
        headers: {
          client_id: TUYA_CLIENT_ID,
          sign: signForToken,
          t: timestamp,
          sign_method: 'HMAC-SHA256'
        }
      });

      if (tokenResponse.data && tokenResponse.data.success) {
        const accessToken = tokenResponse.data.result.access_token;
        const isActivation = ['M', 'P', 'S'].includes(String(comando).toUpperCase().trim());

        const commandPayload = {
          commands: [
            {
              code: "switch_1",
              value: isActivation
            }
          ]
        };

        const actionUrl = `/v1.0/devices/${deviceId}/commands`;
        const tNew = Date.now().toString();

        // Firma correcta para peticiones POST en Tuya Cloud v1.0:
        // HTTPMethod + "\n" + contentHash + "\n" + headers + "\n" + url
        const contentHash = crypto.createHash('sha256').update(JSON.stringify(commandPayload)).digest('hex');
        const stringToSign = ['POST', contentHash, '', actionUrl].join('\n');
        
        // Para la acción POST con token, la cadena es: client_id + accessToken + timestamp + stringToSign
        const strForAction = TUYA_CLIENT_ID + accessToken + tNew + stringToSign;
        const signForAction = crypto.createHmac('sha256', TUYA_SECRET_KEY).update(strForAction).digest('hex').toUpperCase();

        const tuyaRes = await axios.post(`${TUYA_BASE_URL}${actionUrl}`, commandPayload, {
          headers: {
            client_id: TUYA_CLIENT_ID,
            access_token: accessToken,
            sign: signForAction,
            t: tNew,
            sign_method: 'HMAC-SHA256',
            'Content-Type': 'application/json'
          }
        });

        if (tuyaRes.data && tuyaRes.data.success) {
          console.log(`✅ ¡Dispositivo Tuya [${deviceId}] disparado con éxito!`);
        } else {
          console.warn("⚠️ Tuya API respondió con error en comandos:", tuyaRes.data);
        }
      } else {
        console.warn("⚠️ No se pudo autenticar con Tuya:", tokenResponse.data);
      }
    } catch (tuyaEx) {
      console.warn("⚠️ Error al conectar con Tuya Cloud:", tuyaEx.response?.data || tuyaEx.message);
    }

    return {
      success: true,
      message: "Proceso ejecutado con éxito",
      datosResidente: residente
    };

  } catch (error) {
    console.error("Error en ejecutarAlarmaVecinal:", error.message);
    return { success: false, error: error.message };
  }
}
