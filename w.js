const fs = require('fs')

const pipeName = '/tmp/my-pipe'

// Create a writable stream to the named pipe
const writableStream = fs.createWriteStream(pipeName)

let n = 0
const id = setInterval(() => {
  ++n
  console.log(`sending ${n}`)
  writableStream.write(JSON.stringify({ message: `you are number ${String(n).padStart(2, '0')}` }) + '\n')
  if (n >= 20) {
    clearInterval(id)
    console.log(`shut down commencing...`)
    writableStream.end(() => {
      console.log(`... completed`)
      console.log(`*************************************************************`)
      console.log(`*************************************************************`)
      console.log(`*************************************************************`)
      console.log(`*************************************************************`)
      console.log(`*************************************************************`)
      console.log(`*************************************************************`)
      console.log(`*************************************************************`)
      console.log(`*************************************************************`)
    })
  }
})
