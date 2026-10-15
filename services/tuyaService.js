import axios from 'axios';
import crypto from 'crypto';

/**
 * Genera la firma requerida por la API de Tuya Cloud (Signature Version 1 o 2 según corresponda)
 */
function generateTuyaSign(clientId, secret, accessToken, timestamp, method, urlPath, queryParams = {}, body = '') {
  // Nota: Asegúrate de adaptar esto al tipo de firma que use tu versión de Tuya Developer (v1.0 o v2.0)
  // Aquí usamos la estructura estándar de autenticación de Tuya Cloud.
  const signUrl = urlPath;
  const contentHash = crypto.createHash('sha256').update(body).digest('hex');
  const stringToSign = [method, contentHash, '', signUrl].join('\n');
  const str = clientId + (accessToken || '') + timestamp + stringToSign;
  
  return crypto
    .createHmac('sha256', secret)
    .update(str)
    .digest('hex')
    .toUpperCase();
}

/**
 * Obtiene los datos del residente y las credenciales de Tuya consultando el Apps Script
 */
export async function obtenerDatosResidenteYTuya(telefono) {
  try {
    const webAppUrl = process.env.GOOGLE_SHEET_API_URL;
    if (!webAppUrl) {
      throw new Error("La variable de entorno GOOGLE_SHEET_API_URL no está configurada.");
    }

    const response = await axios.get(`${webAppUrl}?telefono=${encodeURIComponent(telefono)}`);
    return response.data;
  } catch (error) {
    console.error("Error al consultar el Apps Script de Google Sheets:", error.message);
    return { encontrado: false, error: error.message };
  }
}

/**
 * Ejecuta el comando en el dispositivo Tuya utilizando las credenciales obtenidas de la hoja
 */
export async function ejecutarComandoTuya(credencialesTuya, deviceId, comando) {
  try {
    if (!credencialesTuya || !credencialesTuya.clientId || !credencialesTuya.clientSecret) {
      throw new Error("No hay credenciales de Tuya válidas para este usuario.");
    }

    const { clientId, clientSecret, region } = credencialesTuya;
    const baseUrl = region === 'eu' ? 'https://openapi.tuyaeu.com' : 'https://openapi.tuyaus.com';
    const timestamp = Date.now().toString();

    // 1. Obtener Token de acceso de Tuya
    const tokenUrl = `${baseUrl}/v1.0/token?grant_type=1`;
    const signForToken = crypto
      .createHmac('sha256', clientSecret)
      .update(clientId + timestamp)
      .digest('hex')
      .toUpperCase();

    const tokenResponse = await axios.get(tokenUrl, {
      headers: {
        client_id: clientId,
        sign: signForToken,
        t: timestamp,
        sign_method: 'HMAC-SHA256'
      }
    });

    if (!tokenResponse.data || !tokenResponse.data.success) {
      throw new Error("Fallo al autenticarse con la API de Tuya.");
    }

    const accessToken = tokenResponse.data.result.access_token;

    // 2. Definir la acción del comando (Ej: Encender/Apagar o disparar alarma según M, S, I, P)
    // Ajusta las propiedades (code / value) según lasSPECs de tu dispositivo en Tuya Developer
    let commandPayload = {
      commands: [
        {
          code: "switch_1", // Reemplaza por el código de tu dispositivo Tuya (ej: alarm_switch, switch_led, etc.)
          value: comando === 'M' || comando === 'S' // True para activar, False para desactivar por ejemplo
        }
      ]
    };

    const actionUrl = `/v1.0/devices/${deviceId}/commands`;
    const tNew = Date.now().toString();
    const signForAction = generateTuyaSign(clientId, clientSecret, accessToken, tNew, 'POST', actionUrl, {}, JSON.stringify(commandPayload));

    // 3. Enviar comando al dispositivo
    const commandResponse = await axios.post(`${baseUrl}${actionUrl}`, commandPayload, {
      headers: {
        client_id: clientId,
        access_token: accessToken,
        sign: signForAction,
        t: tNew,
        sign_method: 'HMAC-SHA256',
        'Content-Type': 'application/json'
      }
    });

    return commandResponse.data;

  } catch (error) {
    console.error("Error al ejecutar comando en Tuya Cloud:", error.response?.data || error.message);
    throw error;
  }
}
