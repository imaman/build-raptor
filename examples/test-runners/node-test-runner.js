#!/usr/bin/env node
// Example custom test runner using Node.js

const { spawn } = require('child_process')
const path = require('path')

const [, , packageDir, packageName, rerunFile] = process.argv

console.log(`Running tests for ${packageName} in ${packageDir}`)

const testProcess = spawn('npm', ['test'], {
  cwd: packageDir,
  stdio: 'inherit',
})

testProcess.on('exit', code => {
  process.exit(code || 0)
})
