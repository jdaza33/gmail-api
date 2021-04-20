/**
 * Test
 */

const Gmail = require('node-gmail-api')
const gmail = new Gmail(
  'ya29.a0AfH6SMAM0OBS0d-2L0e-WwwQL6yHRL-dE2lbbtAvnOnRczZJDiaR0bTJa9irXYEuqzMpyMC-MBFUBxb24aktoc4vcK3kZQ6vmHYb2MLa39WpO4vpLRbHM_StbTS4Ja9pSIoDYJq0bvdXwYFCfkMxeESfJwjqfw'
)
let s = gmail.messages('label:inbox', { max: 10 })

s.on('data', function (d) {
  console.log(d)
})
