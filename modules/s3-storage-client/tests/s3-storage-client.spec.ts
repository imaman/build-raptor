import { NoSuchKey, S3, S3ServiceException } from '@aws-sdk/client-s3'
import { createNopLogger } from 'logger'
import { isObjectNotFoundError } from 'misc'

import { S3StorageClient } from '../src/s3-storage-client.js'

describe('s3-storage-client', () => {
  const newClient = () =>
    new S3StorageClient('some-bucket', 'some/prefix', { accessKeyId: 'a', secretAccessKey: 'b' }, createNopLogger())

  const originalGetObject = S3.prototype.getObject
  function getObjectFailsWith(e: unknown) {
    S3.prototype.getObject = async () => {
      throw e
    }
  }

  afterEach(() => {
    S3.prototype.getObject = originalGetObject
  })

  describe('when reading an object fails', () => {
    test('a 404 (NoSuchKey) is reported as an ObjectNotFoundError', async () => {
      getObjectFailsWith(new NoSuchKey({ message: 'nope', $metadata: { httpStatusCode: 404 } }))
      const e = await newClient()
        .getObject('k')
        .catch(err => err)
      expect(isObjectNotFoundError(e)).toBe(true)
    })
    test('a 403 (AccessDenied) is reported as an ObjectNotFoundError, as S3 uses it for missing objects when s3:ListBucket is not granted', async () => {
      getObjectFailsWith(
        new S3ServiceException({
          name: 'AccessDenied',
          $fault: 'client',
          message: 'Access Denied',
          $metadata: { httpStatusCode: 403 },
        }),
      )
      const e = await newClient()
        .getContentAddressable('abc')
        .catch(err => err)
      expect(isObjectNotFoundError(e)).toBe(true)
      expect(String(e)).toContain('s3:ListBucket')
    })
    test('other errors are not reported as an ObjectNotFoundError', async () => {
      getObjectFailsWith(
        new S3ServiceException({
          name: 'InternalError',
          $fault: 'server',
          message: 'We encountered an internal error',
          $metadata: { httpStatusCode: 500 },
        }),
      )
      const e1 = await newClient()
        .getObject('k')
        .catch(err => err)
      expect(isObjectNotFoundError(e1)).toBe(false)
      expect(String(e1)).toContain('Failed to read an object from S3')

      getObjectFailsWith(new Error('socket hang up'))
      const e2 = await newClient()
        .getObject('k')
        .catch(err => err)
      expect(isObjectNotFoundError(e2)).toBe(false)
    })
  })
})
