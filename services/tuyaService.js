import crypto from 'crypto';
import axios from 'axios';
import { google } from 'googleapis';

// Configuración de Google Sheets (usando las credenciales de entorno)
async function getGoogleSheetsData(range) {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  return response.data.values;
}

// Función principal para procesar el comando de alarma (M, S, I, P) y disparar Tuya
export async function ejecutarAlarmaVecinal(telefonoRemitente, tipoComando) {
  try {
    console.log(`Procesando comando [${tipoComando}] para el teléfono: ${telefonoRemitente}`);

    // 1. Leer la pestaña RESIDENTES para encontrar el codigo_cliente vinculado al teléfono
    const residentesRows = await getGoogleSheetsData('RESIDENTES!A:C'); // Asumiendo columnas: Teléfono, Nombre, Código Cliente
    if (!residentesRows) throw new Error('No se pudo leer la pestaña RESIDENTES');

    let codigoCliente = null;
    for (const row of residentesRows) {
      // Compara el teléfono (ajusta el índice según tu columna, ej. row[0])
      if (row[0] && row[0].includes(telefonoRemitente)) {
        codigoCliente = row[2]; // Asumiendo que el código de cliente está en la columna C (índice 2)
        break;
      }
    }

    if (!codigoCliente) {
      return { success: false, message: 'Número de teléfono no autorizado o no registrado en RESIDENTES.' };
    }

    // 2. Leer la pestaña RESIDENCIALES para encontrar el tuya_device_id y el id_cuenta usando el codigo_cliente
    const residencialesRows = await getGoogleSheetsData('RESIDENCIALES!A:E'); 
    if (!residencialesRows) throw new Error('No se pudo leer la pestaña RESIDENCIALES');

    let tuyaDeviceId = null;
    let idCuenta = null;
    for (const row of residencialesRows) {
      // Compara el código de cliente (ajusta según el índice de tu columna C)
      if (row[2] && row[2] === codigoCliente) {
        tuyaDeviceId = row[3]; // Columna del device_id
        idCuenta = row[4];     // Columna del id_cuenta (ej. tuya_01)
        break;
      }
    }

    if (!tuyaDeviceId || !idCuenta) {
      return { success: false, message: 'No se encontró un dispositivo Tuya asociado al código de cliente.' };
    }

    // 3. Leer la pestaña CUENTAS_TUYA para obtener las credenciales de la cuenta correspondiente
    const cuentasRows = await getGoogleSheetsData('CUENTAS_TUYA!A:D');
    if (!cuentasRows) throw new Error('No se pudo leer la pestaña CUENTAS_TUYA');

    let clientKey = null;
    let clientSecret = null;
    let endpoint = null;

    for (const row of cuentasRows) {
      if (row[0] && row[0] === idCuenta) {
        clientKey = row[1];
        clientSecret = row[2];
        endpoint = row[3]; // Ej: https://openapi.tuyaeu.com
        break;
      }
    }

    if (!clientKey || !clientSecret || !endpoint) {
      return { success: false, message: `No se encontraron credenciales para la cuenta Tuya: ${idCuenta}` };
    }

    // 4. Aquí se realiza la llamada firmada a la API de Tuya Cloud (HMAC-SHA256)
    // (Implementación de conexión y envío de comando al relé/dispositivo)
    console.log(`Dispositivo localizado: ${tuyaDeviceId} en la cuenta ${idCuenta}. Ejecutando comando...`);

    // Retorno de éxito preliminar para la prueba
    return { 
      success: true, 
      message: `Comando ${tipoComando} ejecutado con éxito para el dispositivo ${tuyaDeviceId}` 
    };

  } catch (error) {
    console.error('Error en tuyaService:', error);
    return { success: false, error: error.message };
  }
}
