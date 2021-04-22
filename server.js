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
  oAuth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      oAuth2Client.setCredentials({
        refresh_token: tokens.refresh_token,
      })
    }
    oAuth2Client.setCredentials({
      refresh_token: tokens.refresh_token,
    })
  })
}

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
        // console.log(res)
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

      resolve({
        body: Buffer.from(
          res.data.payload.parts[0].body.data,
          'base64'
        ).toString('utf-8'),
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
 * @param {String} data
 * @param {String} subj
 * @returns {Object}
 */
function getData(data, subj) {
  console.log(data)

  if (data.indexOf('|') >= 0) {
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
      //Iniciamos la db
      await sql.connect(process.env.URL_DB)

      //Insertamos los datos
      const result = await sql.query(
        `INSERT INTO GmailAPI.dbo.reporte (nombre, direccion, cp, telefono1, telefono2, aparato, marca, averia, createdAt, status, nro) VALUES('${nombre}', '${direccion}', '${cp}', '${telefono1}', '${telefono2}', '${aparato}', '${marca}', '${averia}', ${moment().valueOf()}, '0', ${nro})`
      )
      console.log(result)
      return resolve(result)
    } catch (error) {
      console.log(error)
      return reject(error)
    }
  })
}

function main() {
  return new Promise(async (resolve, reject) => {
    try {
      let messages = await listMessages()

      for (let message of messages) {
        let { body: text, subject } = await getBodyMessage(message.id)
        let { data, success } = getData(text, subject)
        if (success) {
          console.log(data)
          // await insertDb(data)
          // await modifyMessage(message.id)
        }
      }

      resolve()
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

// cron.schedule('0,5,10,15,20,25,30,35,40,45,50,55 * * * *', () => {
//   main()
// })

//Listen
app.listen(3001, () => console.log('Servidor iniciado'))
