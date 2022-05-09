import { Driver } from 'build-raptor-core-testkit'

jest.setTimeout(30000)
describe('b', () => {
  const testName = () => expect.getState().currentTestName

  test('runs the build and test tasks of a package and captures their output', async () => {
    const driver = new Driver(testName())
    const recipe = {
      'package.json': {
        name: 'foo',
        private: true,
        workspaces: ['modules/*'],
      },
      'modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        scripts: {
          build: 'echo "building now"',
          test: 'echo "testing now"',
        },
      },
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK')
    expect(await run.outputOf('build', 'a')).toEqual(['building now'])
    expect(await run.outputOf('test', 'a')).toEqual(['testing now'])
  })
})
