import axios from 'axios';
import crypto from 'crypto';

// Credenciales fijas de Tuya (Data Center Europa)
const TUYA_CLIENT_ID = '33v9xxh5vmvs3arqm8vj';
const TUYA_SECRET_KEY = 'd725d7c48f9d4b34a87901aba4bdf935';
const TUYA_BASE_URL = 'https://openapi.tuyaeu.com';

export async function ejecutarAlarmaVecinal(telefono, comando) {
  try {
    const webAppUrl = process.env.GOOGLE_SHEET_API_URL;
    if (!webAppUrl) {
      throw new Error("La variable de entorno GOOGLE_SHEET_API_URL no está configurada.");
    }

    // 1. Consultamos al WebApp de Google Sheets para obtener los datos del residente y el deviceId de Tuya
    const response = await axios.get(`${webAppUrl}?telefono=${encodeURIComponent(telefono)}`);
    const data = response.data;

    if (!data || !data.encontrado) {
      return { success: false, error: data.error || "Residente no encontrado en la base de datos." };
    }

    const residente = data.residente;
    
    // Obtenemos el Device ID que Google Apps Script extrajo de la pestaña RESIDENCIALES (Columna E)
    const deviceId = data.tuyaDeviceId || data.deviceId;

    if (!deviceId) {
      console.warn("⚠️ No se encontró un Device ID de Tuya en la pestaña RESIDENCIALES.");
      return { success: true, message: "Alerta enviada por WhatsApp, pero sin dispositivo Tuya asociado." };
    }

    // --- 2. EJECUCIÓN HARDWARE TUYA CLOUD ---
    try {
      const timestamp = Date.now().toString();

      // Generar Token de acceso en Tuya
      const tokenUrl = `${TUYA_BASE_URL}/v1.0/token?grant_type=1`;
      const signForToken = crypto
        .createHmac('sha256', TUYA_SECRET_KEY)
        .update(TUYA_CLIENT_ID + timestamp)
        .digest('hex')
        .toUpperCase();

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

        // Validar si el comando activa la alarma/relé ('M', 'P', 'S')
        const isActivation = ['M', 'P', 'S'].includes(String(comando).toUpperCase().trim());

        const commandPayload = {
          commands: [
            {
              code: "switch_1", // Código estándar del relé en Tuya
              value: isActivation
            }
          ]
        };

        const actionUrl = `/v1.0/devices/${deviceId}/commands`;
        const tNew = Date.now().toString();

        const contentHash = crypto.createHash('sha256').update(JSON.stringify(commandPayload)).digest('hex');
        const stringToSign = ['POST', contentHash, '', actionUrl].join('\n');
        const str = TUYA_CLIENT_ID + accessToken + tNew + stringToSign;
        const signForAction = crypto.createHmac('sha256', TUYA_SECRET_KEY).update(str).digest('hex').toUpperCase();

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
          console.log(`✅ Dispositivo Tuya [${deviceId}] disparado correctamente en Europa.`);
        } else {
          console.warn("⚠️ Tuya API respondió con error:", tuyaRes.data);
        }
      } else {
        console.warn("⚠️ No se pudo autenticar con la API de Tuya:", tokenResponse.data);
      }
    } catch (tuyaEx) {
      console.warn("⚠️ Aviso: Error al intentar disparar el hardware Tuya:", tuyaEx.response?.data || tuyaEx.message);
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
