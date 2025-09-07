# Custom Test Commands Configuration

Build Raptor supports custom test commands on a per-package basis, allowing you to use alternative test runners instead of Jest. This feature can be controlled globally through a repository-wide configuration switch.

## Configuration

### Enabling/Disabling Custom Test Commands

The custom test command feature is controlled by the `enableCustomTestCommands` option in the `.build-raptor.json` configuration file:

```json
{
  "repoProtocol": {
    "enableCustomTestCommands": true // or false to disable
  }
}
```

- **Default value**: `true` (custom test commands are enabled)
- When set to `true`: Packages can use custom test commands if configured
- When set to `false`: All packages will use the standard Jest runner, ignoring any custom test command configurations

### Package-Level Configuration

When custom test commands are enabled globally, individual packages can specify their own test command in their `package.json`:

```json
{
  "name": "my-package",
  "buildRaptor": {
    "testCommand": "path/to/custom-test-runner"
  }
}
```

The custom test runner will receive three arguments:

1. Package directory absolute path
2. Package name (unit ID)
3. Rerun file path (for tracking failed tests)

## Examples

### Example 1: Disable Custom Test Commands Globally

To force all packages to use Jest regardless of their individual configurations:

**.build-raptor.json:**

```json
{
  "repoProtocol": {
    "enableCustomTestCommands": false
  }
}
```

### Example 2: Enable Custom Test Commands (Default)

To allow packages to use custom test commands:

**.build-raptor.json:**

```json
{
  "repoProtocol": {
    "enableCustomTestCommands": true
  }
}
```

Or simply omit the option (defaults to `true`):

**.build-raptor.json:**

```json
{
  "repoProtocol": {}
}
```

### Example 3: Package with Custom Test Runner

When custom test commands are enabled, a package can specify its test runner:

**modules/my-package/package.json:**

```json
{
  "name": "my-package",
  "buildRaptor": {
    "testCommand": "tools/node-test-runner"
  }
}
```

**tools/node-test-runner:**

```bash
#!/bin/bash
# Custom test runner using Node.js built-in test runner
cd $1  # Change to package directory
node --test --test-reporter spec dist/tests/**/*.spec.js
```

## Use Cases

This configuration is useful when:

1. **Standardization**: You want to enforce a single test runner across all packages in your monorepo
2. **Migration**: You're migrating from custom test runners to Jest (or vice versa) and need a kill switch
3. **Debugging**: You need to temporarily disable custom test runners to isolate issues
4. **CI/CD**: Different environments may require different test runner configurations

## Notes

- The switch only affects the test execution; it doesn't change how tests are written
- When disabled, packages with custom test commands will fall back to Jest
- Custom test runners must be executable and handle the provided arguments correctly
- The feature is backward compatible - existing repositories without this configuration will continue to work as before (custom test commands enabled)
