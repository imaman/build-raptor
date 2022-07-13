import { Stream } from 'stream'

// This should be equivalent to the buffer() function of 'stream/consumers'
// (https://nodejs.org/dist/latest-v16.x/docs/api/webstreams.html#streamconsumersbufferstream)
// Yet, we implemented it since as of Node v16.14.2 using it yield the following warning:
// "ExperimentalWarning: buffer.Blob is an experimental feature. This feature could change at any time"
export async function streamTobuffer(stream: Stream): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Uint8Array[] = []

    stream.on('data', chunk => {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, 'utf-8'))
      } else if (chunk instanceof Buffer) {
        chunks.push(chunk)
      } else {
        reject(new Error(`Unsupported chunk type: ${typeof chunk}`))
      }
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', err => reject(new Error(`error converting stream - ${err}`)))
  })
}
