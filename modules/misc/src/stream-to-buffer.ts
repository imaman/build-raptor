import { Stream } from 'stream'

export async function streamTobuffer(stream: Stream): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const _buf: Uint8Array[] = []

    stream.on('data', chunk => _buf.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(_buf)))
    stream.on('error', err => reject(`error converting stream - ${err}`))
  })
}
