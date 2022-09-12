import { LambdaClient } from './lambda-client'

/* eslint-disable no-console */
async function main() {
  const lc = new LambdaClient('INI_FILE')
  const resp = await lc.invoke('d-prod-buildTrackerService', {
    endpointName: 'resolveAssetLocation',
    endpointRequest: { packageName: 'y' },
  })
  console.log(`resp=${JSON.stringify(resp, null, 2)}`)
  // const s3 = new S3StorageClient(
  //   'moojo-dev-infra',
  //   's3sc-playground',
  //   { accessKeyId: '', secretAccessKey: '' },
  //   createNopLogger(),
  // )

  // console.log(await s3.objectExists('alpha'), await s3.objectExists('(ii)'), await s3.objectExists('3/3'))
  // await s3.putObject(
  //   'alpha',
  //   'An object at rest remains at rest, and an object in motion remains in motion at constant speed and in a straight line unless acted on by an unbalanced force.',
  // )
  // console.log(await s3.objectExists('alpha'), await s3.objectExists('(ii)'), await s3.objectExists('3/3'))
  // await s3.putObject(
  //   '(ii)',
  //   'The acceleration of an object depends on the mass of the object and the amount of force applied.',
  // )
  // console.log(await s3.objectExists('alpha'), await s3.objectExists('(ii)'), await s3.objectExists('3/3'))
  // await s3.putObject(
  //   '3/3',
  //   'Whenever one object exerts a force on another object, the second object exerts an equal and opposite on the first.',
  // )
  // console.log(await s3.objectExists('alpha'), await s3.objectExists('(ii)'), await s3.objectExists('3/3'))

  // console.log(JSON.stringify(await s3.getObject('alpha')))
  // console.log(JSON.stringify(await s3.getObject('(ii)')))
  // console.log(JSON.stringify(await s3.getObject('3/3')))
}

main()
