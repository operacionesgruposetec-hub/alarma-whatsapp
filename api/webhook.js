function doGet(e) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("RESIDENTES");
    
    if (!sheet) {
      return responderJSON({ encontrado: false, error: "Pestaña RESIDENTES no encontrada" });
    }

    var rows = sheet.getDataRange().getValues();
    
    // Lo que llega del webhook (puede ser el número o el LID)
    var valorBuscado = String(e.parameter.telefono || "").trim();
    var digitosBuscados = valorBuscado.replace(/\D/g, '');
    
    var resultado = { encontrado: false };
    
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var telefonoHoja = String(row[1] || "").trim(); // Columna de teléfono
      var digitosHoja = telefonoHoja.replace(/\D/g, '');
      var lidHoja = String(row[6] || "").trim();      // Columna opcional para el LID (Columna G, índice 6 si la creas)
      
      // Comparamos si hace match con el teléfono, con los dígitos, o con el LID registrado
      var matchTelefono = (digitosHoja && digitosBuscados && (digitosHoja === digitosBuscados || digitosBuscados.endsWith(digitosHoja) || digitosHoja.endsWith(digitosHoja)));
      var matchLid = (lidHoja && valorBuscado && lidHoja === valorBuscado);

      if (matchTelefono || matchLid) {
        var coordsString = String(row[4] || "").trim();
        var lat = 0;
        var lon = 0;
        
        if (coordsString.includes(",")) {
          var partes = coordsString.split(",");
          lat = parseFloat(partes[0].trim()) || 0;
          lon = parseFloat(partes[1].trim()) || 0;
        }

        resultado = {
          encontrado: true,
          residente: {
            codigoCliente: row[0],
            telefono: row[1],
            nombre: row[2],
            domicilio: row[3],
            latitud: lat,
            longitud: lon,
            foto: row[5] || ""
          }
        };
        break;
      }
    }

    return responderJSON(resultado);

  } catch (err) {
    return responderJSON({ encontrado: false, error: err.toString() });
  }
}

function responderJSON(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}
