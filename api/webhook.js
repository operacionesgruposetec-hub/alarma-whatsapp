import axios from 'axios';
import crypto from 'crypto';

/**
 * Función unificada que consulta el Apps Script, dispara el dispositivo Tuya 
 * y retorna la información del residente para el webhook de WhatsApp.
 */
export async function ejecutarAlarmaVecinal(telefono, comando) {
  try {
    const webAppUrl = process.env.GOOGLE_SHEET_API_URL;
    if (!webAppUrl) {
      throw new Error("La variable de entorno GOOGLE_SHEET_API_URL no está configurada.");
    }

    // 1. Consultar el Apps Script unificado (RESIDENTES -> RESIDENCIALES -> CUENTAS_TUYA)
    const response = await axios.get(`${webAppUrl}?telefono=${encodeURIComponent(telefono)}`);
    const data = response.data;

    if (!data || !data.encontrado) {
      return { success: false, error: data.error || "Residente no encontrado en la base de datos." };
    }

    const residente = data.residente;
    const tuyaInfo = data.tuya;

    // Si tiene configurado un dispositivo Tuya y credenciales, intentamos dispararlo
    if (tuyaInfo && tuyaInfo.deviceId && tuyaInfo.credenciales) {
      try {
        const { clientId, clientSecret, region } = tuyaInfo.credenciales;
        const deviceId = tuyaInfo.deviceId;
        
        const baseUrl = region === 'eu' ? 'https://openapi.tuyaeu.com' : 'https://openapi.tuyaus.com';
        const timestamp = Date.now().toString();

        // Obtener Token de acceso de Tuya
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

        if (tokenResponse.data && tokenResponse.data.success) {
          const accessToken = tokenResponse.data.result.access_token;

          // Payload del comando Tuya (ajusta 'switch_1' o el code según tu relé)
          const commandPayload = {
            commands: [
              {
                code: "switch_1", 
                value: comando === 'M' || comando === 'S'
              }
            ]
          };

          const actionUrl = `/v1.0/devices/${deviceId}/commands`;
          const tNew = Date.now().toString();
          
          // Firma para el comando POST
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

          console.log(`✅ Dispositivo Tuya ${deviceId} activado correctamente.`);
        }
      } catch (tuyaEx) {
        console.warn("⚠️ Aviso: No se pudo disparar el hardware Tuya, pero se continuará con el flujo de WhatsApp:", tuyaEx.response?.data || tuyaEx.message);
      }
    }

    // Retornamos éxito junto con los datos del residente para que el webhook los use
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
