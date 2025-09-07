# Custom Test Runners in Build Raptor

Build Raptor supports custom test execution programs as an alternative to the default Jest runner. This allows you to use any test framework or custom test orchestration logic while maintaining Build Raptor's caching and parallelization benefits.

## Configuration

To use a custom test runner, add a `testCommand` field to your package.json's `buildRaptor` configuration:

```json
{
  "name": "@myrepo/my-package",
  "buildRaptor": {
    "testCommand": "tools/test-runners/vitest.sh"
  }
}
```

## How It Works

1. The `testCommand` value is a path relative to the repository root
2. The command is executed from the package's directory
3. The command receives three arguments:
   - `$1`: Package directory absolute path
   - `$2`: Package name (unit ID)
   - `$3`: Rerun file path (for test retry functionality)
4. Exit code 0 indicates success, non-zero indicates failure
5. stdout and stderr are automatically captured to Build Raptor's output files

## Examples

### Using Vitest

```bash
#!/bin/bash
# tools/test-runners/vitest.sh
cd "$1"
npx vitest run
```

### Using Playwright

```javascript
#!/usr/bin/env node
// tools/test-runners/playwright.js
const { spawn } = require('child_process')
const [, , packageDir, packageName] = process.argv

const proc = spawn('npx', ['playwright', 'test'], {
  cwd: packageDir,
  stdio: 'inherit',
})

proc.on('exit', code => process.exit(code))
```

### Using Mocha

```bash
#!/bin/bash
# tools/test-runners/mocha.sh
cd "$1"
npx mocha "test/**/*.js" --reporter spec
exit_code=$?

# Optionally create a rerun list for failed tests
# (Build Raptor will create an empty one if not provided)
if [ $exit_code -ne 0 ]; then
  echo "[]" > "$3"
fi

exit $exit_code
```

### Using Node.js Built-in Test Runner

```javascript
#!/usr/bin/env node
// tools/test-runners/node-test.js
const { spawn } = require('child_process')
const [, , packageDir, packageName] = process.argv

const proc = spawn('node', ['--test', 'test/'], {
  cwd: packageDir,
  stdio: 'inherit',
})

proc.on('exit', code => process.exit(code))
```

## Migration Guide

1. Create your test runner script in a shared location (e.g., `tools/test-runners/`)
2. Make the script executable: `chmod +x tools/test-runners/my-runner.sh`
3. Add `testCommand` to packages that should use the custom runner
4. Test the configuration: `yarn build-raptor --labels test --units my-package`
5. Packages without `testCommand` will continue using Jest

## Best Practices

- Keep test runners in a centralized location for reuse
- Use exit codes consistently (0 for success, non-zero for failure)
- Consider outputting machine-readable results for CI integration
- Test runners should be idempotent and deterministic
- Always handle cleanup in your test runners (temp files, processes, etc.)

## Advanced Features

### Rerun Failed Tests

Build Raptor supports rerunning only failed tests by using the rerun file (third argument). Your custom runner can read this file to determine which tests to run:

```javascript
#!/usr/bin/env node
const fs = require('fs')
const [, , packageDir, packageName, rerunFile] = process.argv

// Check if rerun file exists and has content
let testsToRun = []
if (fs.existsSync(rerunFile)) {
  const content = fs.readFileSync(rerunFile, 'utf-8')
  testsToRun = JSON.parse(content)
}

if (testsToRun.length > 0) {
  // Run only specific failed tests
  console.log('Rerunning failed tests:', testsToRun)
  // ... your test runner logic for specific tests
} else {
  // Run all tests
  console.log('Running all tests')
  // ... your test runner logic for all tests
}
```

### Integration with Validation Scripts

Custom test runners work seamlessly with Build Raptor's validation scripts. If a package has a `validate` script and the custom test passes, the validation script will run automatically:

```json
{
  "name": "@myrepo/my-package",
  "scripts": {
    "validate": "eslint src/ --max-warnings 0"
  },
  "buildRaptor": {
    "testCommand": "tools/test-runners/custom.sh"
  }
}
```

### Caching Behavior

Custom test runners benefit from Build Raptor's caching system:

- Test results are cached based on input file fingerprints
- Cached tests are skipped on subsequent runs if inputs haven't changed
- The cache key includes the test command itself, so changing the runner invalidates the cache

## Troubleshooting

### Common Issues

1. **Permission Denied Error**

   - Ensure your script is executable: `chmod +x path/to/script`

2. **Command Not Found**

   - Verify the path is relative to the repository root
   - Check that the file exists at the specified location

3. **Tests Always Fail**

   - Check the exit code of your script
   - Ensure you're exiting with code 0 on success

4. **No Output Captured**

   - Verify your script writes to stdout/stderr
   - Avoid using `stdio: 'ignore'` in child processes

5. **Rerun Not Working**
   - Create the rerun file (third argument) with JSON array format
   - Empty array `[]` means no tests to rerun

## Comparison with Default Jest Runner

| Feature                  | Jest (Default)     | Custom Test Runner        |
| ------------------------ | ------------------ | ------------------------- |
| Automatic test discovery | ✓                  | Depends on implementation |
| Rerun failed tests       | ✓                  | Optional (via rerun file) |
| Parallel test execution  | ✓ (within package) | Depends on implementation |
| Coverage reports         | ✓                  | Depends on implementation |
| Test result reporting    | ✓ (detailed)       | Basic (exit code)         |
| Configuration            | jest.config.js     | Custom script             |

## Security Considerations

- Custom test runners execute with the same permissions as Build Raptor
- Validate and sanitize any dynamic inputs in your test runners
- Avoid executing untrusted code or commands
- Use absolute paths when referencing files to avoid path traversal issues

## Future Enhancements

Planned improvements for custom test runners:

- Structured test result reporting format
- Built-in support for popular test frameworks
- Test runner templates and generators
- Enhanced debugging and logging options
- Performance metrics collection
