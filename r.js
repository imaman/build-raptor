const fs = require('fs')

const pipeName = '/tmp/my-pipe'

// Create a readable stream from the named pipe
const readableStream = fs.createReadStream(pipeName)

let acc = ''
// Listen for 'data' event to read data from the named pipe
readableStream.on('data', data => {
  console.log(`data=${data.toString('utf-8')}`)
  acc += data.toString('utf-8')
  console.log(`acc=${JSON.stringify(acc)}`)
  while (true) {
    const eol = acc.indexOf('\n')
    if (eol < 0) {
      break
    }
    const part = acc.slice(0, eol)
    console.log(`Received: ${JSON.parse(part).message}`)
    acc = acc.slice(eol + 1)
  }
})

// Listen for 'end' event to know when reading is complete
readableStream.on('end', () => {
  console.log('Finished reading from the named pipe.')
})
