const fs = require('fs')

const pipeName = '/tmp/my-pipe'

// Create a readable stream from the named pipe
const readableStream = fs.createReadStream(pipeName)

let acc = ''

function dump() {
  while (true) {
    const eol = acc.indexOf('\n')
    if (eol < 0) {
      break
    }
    const part = acc.slice(0, eol)
    acc = acc.slice(eol + 1)
    console.log(`Received: ${JSON.parse(part).message} (left=${acc.length})`)
  }
}

// Listen for 'data' event to read data from the named pipe
readableStream.on('data', data => {
  acc += data.toString('utf-8')
  dump()
})

// Listen for 'end' event to know when reading is complete
readableStream.on('end', () => {
  console.log('Finished reading from the named pipe.')
  dump()
  setTimeout(() => {
    console.log(`very last timeout fired!`)
  }, 2000)
})
