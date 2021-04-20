/**
 * Base de datos
 */
const sql = require('mssql')
const moment = require('moment')

console.log(moment().format('YYYY-MM-DDTHH:MM:SS').toString())

const consultar = async () => {
  try {
    // make sure that any items are correctly URL encoded in the connection string
    await sql.connect(
      'mssql://Jose:m8nEXz%25%25WrG1@rapitecnic.dyndns.org/GmailAPI'
    )
    // const result = await sql.query`select * from reporte`
    const result = await sql.query`INSERT INTO GmailAPI.dbo.reporte
    (nombre, direccion, cp, telefono1, telefono2, aparato, marca, averia, createdAt, status, nro)
    VALUES('${'test'}', '${'test'}', '${'123123'}', '${'+58'}', '${'+52'}', '${'aire'}', '${'otro'}', '${'se daño'}', ${moment()
      .format('YYYY-MM-DDTHH:MM:SS')
      .toString()}, '0', ${45});
    `
    console.dir(result)
  } catch (err) {
    console.log(err)
  }
}

consultar()
