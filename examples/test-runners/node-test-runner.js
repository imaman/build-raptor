#!/usr/bin/env node
// Example custom test runner that uses Node.js's built-in test runner.
// Arguments: argv[2]=package_dir, argv[3]=package_name, argv[4]=rerun_file (unused here)
// build-raptor only cares about the exit code.

const { spawn } = require('child_process')
const path = require('path')

const [, , packageDir, packageName] = process.argv

console.log(`Running tests for ${packageName} in ${packageDir}`)

// The package's tests/ directory is compiled into dist/tests/ by the build task.
const testProcess = spawn('node', ['--test', '--test-reporter', 'spec', path.join(packageDir, 'dist', 'tests')], {
  cwd: packageDir,
  stdio: 'inherit',
})

testProcess.on('error', err => {
  console.error(err)
  process.exit(1)
})

testProcess.on('exit', code => {
  process.exit(code ?? 1)
})
