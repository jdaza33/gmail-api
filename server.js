/**
 * Servidor
 */

require('dotenv').config()
const { google } = require('googleapis')
const sql = require('mssql')
const express = require('express')
const cors = require('cors')
const fs = require('fs')
const path = require('path')
const decode = require('urldecode')
const moment = require('moment')
const cron = require('node-cron')
const pm2 = require('pm2')
const ConnectionSql = require('tedious').Connection
const RequestSql = require('tedious').Request
const TYPES = require('tedious').TYPES
const connectionSql = new ConnectionSql({
  server: process.env.HOST_DB,
  options: {
    database: process.env.DATABASE_DV,
    encrypt: false,
    rowCollectionOnRequestCompletion: true,
  },
  authentication: {
    type: 'default',
    options: {
      userName: process.env.USER_DB,
      password: process.env.PASS_DB,
    },
  },
})

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify']

const oAuth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID_GMAIL,
  process.env.SECRET_ID_GMAIL,
  process.env.URL_AUTH_GMAIL
)

// Verificamos el token
if (fs.existsSync('./token.json')) {
  const token = require('./token.json')
  oAuth2Client.setCredentials(JSON.parse(JSON.stringify(token)))
  // oAuth2Client.setCredentials({
  //   refresh_token: token.refresh_token,
  // })
}

oAuth2Client.on('tokens', (tokens) => {
  console.log('tokens', tokens)
  global.expireTokenMs = tokens.expiry_date
})

/**
 * Listar los correos no leidos
 * @returns {Array} Lista de mensajes
 */
function listMessages() {
  return new Promise((resolve, reject) => {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client })

    gmail.users.messages.list(
      {
        userId: 'me',
        q:
          'from:pedidos@satdelamarca.com OR from:pedidos.2@satdelamarca.com OR from:pedidos.3@satdelamarca.com OR from:dmartinez@electrorenova.es OR from:blackencio33@gmail.com is:unread',
      },
      (err, res) => {
        if (err) {
          console.log(err)
          return reject(err)
        }
        if (!res.data.messages) return resolve([])
        // console.log(res.data.messages)
        return resolve(res.data.messages)
      }
    )
  })
}

/**
 * Obtener los detalles de un correo dado el id
 * @param {String} id
 * @returns {String}
 */
function getBodyMessage(id) {
  return new Promise((resolve, reject) => {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client })

    gmail.users.messages.get({ userId: 'me', id }, (err, res) => {
      if (err) reject(err)

      // console.log(res.data.payload)
      let subject = res.data.payload.headers.find((h) => h.name == 'Subject')
      console.log(res.data.payload.parts)

      let parts = []
      for (let part of res.data.payload.parts) {
        parts.push(Buffer.from(part.body.data, 'base64').toString('utf-8'))
      }

      resolve({
        parts,
        subject: subject ? subject.value : 0,
      })
    })
  })
}

/**
 * Remueve el valor UNREAD de los labels de un correo dado el id
 * @param {String} id
 * @returns
 */
function modifyMessage(id) {
  return new Promise((resolve, reject) => {
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client })

    gmail.users.messages.modify(
      { userId: 'me', id, removeLabelIds: ['UNREAD'] },
      (err, res) => {
        if (err) {
          reject(err)
          return
        }
        console.log(res.data)
        resolve()
      }
    )
  })
}

/**
 * Separa los datos de un string que usa el delimitador |
 * @param {Array} parts
 * @param {String} subj
 * @returns {Object}
 */
function getData(parts, subj) {
  console.log(parts)

  let data = parts.find((p) => p.indexOf('|') >= 0)

  if (data) {
    let arrayData = data.split('|')
    let newArrayData = []

    //Verificamos si faltan campos
    if (arrayData.length < 8) {
      let part1 = [...arrayData].slice(0, 4)
      let part2 = [...arrayData].slice(4, 8)
      newArrayData = [...part1, '', ...part2]
    }

    let [
      nombre,
      direccion,
      cp,
      telefono1,
      telefono2,
      aparato,
      marca,
      averia,
    ] = newArrayData

    //Modificamos el nombre
    let __nombre = nombre.split('\r\n')
    nombre = __nombre[__nombre.length - 1] || nombre

    //Verificamos el telefono
    let [t1, t2] = telefono1.split(',')
    if (t1) telefono1 = t1
    if (t2) telefono2 = t2

    //Obtenemos el nro
    let nro = null
    if (typeof subj != 'number') {
      let [_nro] = subj.split(' ')
      nro = parseInt(_nro.trim())
    } else nro = subj

    return {
      success: true,
      data: {
        nombre: nombre && nombre.trim(),
        direccion: direccion && direccion.trim(),
        cp: cp && cp.trim(),
        telefono1: telefono1 && telefono1.trim(),
        telefono2: telefono2 && telefono2.trim(),
        aparato: aparato && aparato.trim(),
        marca: marca && marca.trim(),
        averia: averia && averia.trim(),
        nro,
      },
    }
  } else return { success: false }
}

/**
 * Insertamos los datos en la base de datos
 * @param {Object} data
 * @returns
 */
function insertDb({
  nombre,
  direccion,
  cp,
  telefono1,
  telefono2,
  aparato,
  marca,
  averia,
  nro,
}) {
  return new Promise(async (resolve, reject) => {
    try {
      let requestSql = new RequestSql(
        `INSERT INTO GmailAPI.dbo.reporte (nombre, direccion, cp, telefono1, telefono2, aparato, marca, averia, createdAt, status, nro) 
        VALUES('${nombre}', '${direccion}', '${cp}', '${telefono1}', '${telefono2}', '${aparato}', '${marca}', '${averia}', @createdAt, '0', ${nro})`,
        function (err, rowCount, rows) {
          if (err) {
            console.log(err)
            return reject(err)
          } else console.log('Datos insertados con éxito.')
        }
      )

      requestSql.addParameter('createdAt', TYPES.DateTime, moment())

      connectionSql.execSql(requestSql)

      return resolve()
    } catch (error) {
      console.log(error)
      return reject(error)
    }
  })
}

function main() {
  return new Promise(async (resolve, reject) => {
    console.log(
      `\n\n################################## ${new Date()} #####################################`
    )
    try {
      let messages = await listMessages()

      if (messages.length == 0) console.log('No hay registros nuevos..')

      for (let message of messages) {
        let { parts, subject } = await getBodyMessage(message.id)
        // console.log(text, subject)
        let { data, success } = getData(parts, subject)
        if (success) {
          console.log(data)
          await insertDb(data)
          await modifyMessage(message.id)
        }
      }

      return resolve()
    } catch (error) {
      return reject(error)
    }
  })
}

function checkAccessToken() {
  return new Promise(async (resolve, reject) => {
    try {
      if (global.expireTokenMs) {
        let now = Date.now()
        if (now > global.expireTokenM)
          pm2.restart('server', (err, proc) => {
            console.log('### Token actualizado ###')
          })
      }

      return resolve()
    } catch (error) {
      return reject(error)
    }
  })
}

//APP
const app = express()
app.use(cors())

app.get('/gmail', async (req, res, next) => {
  try {
    let { code } = req.query
    code = decode(code)

    const { tokens } = await oAuth2Client.getToken(code)
    oAuth2Client.setCredentials(tokens)

    oAuth2Client.on('tokens', (tokens) => {
      console.log(tokens)
      if (tokens.refresh_token) {
        oAuth2Client.setCredentials({
          refresh_token: tokens.refresh_token,
        })
      }
      oAuth2Client.setCredentials({
        refresh_token: tokens.refresh_token,
      })
    })

    res.sendFile(path.join(__dirname + '/views/landing.html'))
  } catch (error) {
    console.log(error)
    res.status(403).json({ success: 0, error })
  }
})

app.get('/auth', async (req, res, next) => {
  try {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    })
    res.redirect(authUrl)
  } catch (error) {
    console.log(error)
    res.status(403).json({ success: 0, error })
  }
})

app.get('/execute', async (req, res, next) => {
  try {
    await main()
    res.json({ success: 1 })
  } catch (error) {
    console.log(error)
    res.status(403).json({ success: 0, error })
  }
})

app.get('/success', async (req, res, next) => {
  try {
    res.sendFile(path.join(__dirname + '/views/landing.html'))
  } catch (error) {
    console.log(error)
    res.status(403).json({ success: 0, error })
  }
})

//Eventos
connectionSql.on('connect', function (err) {
  if (err) console.log('Error: ', err)

  cron.schedule('0,5,10,15,20,25,30,35,40,45,50,55 * * * *', () => {
    main()
  })

  cron.schedule('* * * * *', () => {
    checkAccessToken()
  })

  //Listen
  app.listen(3001, () => console.log('Servidor iniciado'))
})

//Conectado con la base de datos
connectionSql.connect()
