# Custom Test Runners

By default, the `test` task of a package runs Jest. A package can instead name its own test command, which lets you
use any test framework (e.g., `node --test`, Vitest, Mocha) while keeping build-raptor's caching.

This feature is part of the Yarn repo protocol.

## Setup

1. Write an executable program (script or binary) somewhere in the repo, e.g. `tools/test-runners/node-test`:

   ```bash
   #!/bin/bash
   cd "$1"
   node --test --test-reporter spec dist/tests/
   ```

2. Make it executable: `chmod +x tools/test-runners/node-test`

3. Point the package at it, in the package's `package.json`:

   ```json
   {
     "name": "my-package",
     "buildRaptor": {
       "testCommand": "tools/test-runners/node-test"
     }
   }
   ```

   The path is relative to the repo root. Packages without `testCommand` keep using Jest.

## The contract

build-raptor runs the command as-is (not through a shell, not via `npm run`). The working directory is the package's
directory and the command gets three arguments:

| Argument | Value                                                                         |
| -------- | ----------------------------------------------------------------------------- |
| `$1`     | Absolute path of the package directory                                        |
| `$2`     | Package name                                                                  |
| `$3`     | Absolute path of the rerun file (`<package-dir>/jest-output.json`), see below |

- **Result**: exit code `0` means the task passed; any other exit code means it failed.
- **Output**: stdout and stderr are captured as the task's output (what build-raptor prints for a failing task).
- **What to run**: tests are compiled like the rest of the package, so the runner should run the compiled files under
  `dist/tests/` (not the `.ts` sources).

## When the command runs

- **Only if there are spec files.** If the package's `tests/` directory has no `*.spec.ts` files (at any depth), the
  test command is not run. The task's verdict is then that of the package's `validate` script, or pass if there is
  none.
- **`validate` runs alongside it.** If the package has a `validate` script, it runs in parallel with the test command.
  The task fails if the test command fails; otherwise the task's verdict is that of `validate`.
- **Caching.** The test task is skipped when its inputs are unchanged since a passing run. The inputs are the package's
  `package.json`, its `dist/src` and `dist/tests`, and the `dist/src` of the packages it depends on. The runner program
  itself is _not_ an input: editing the script does not invalidate cached results (changing the `testCommand` value
  does, since it is in `package.json`).

## The rerun file

The third argument is a file the runner may use to remember which tests failed:

- When a test task failed and is run again with the same inputs, build-raptor restores the file as the previous run
  left it, before invoking the command. A runner can read it and run only the failing tests.
- When the inputs changed (or on the first run), the file does not exist.
- The format is up to the runner; build-raptor does not read the file for custom runners. If the runner does not create
  it, build-raptor writes an empty list (`[]`).

## Turning the feature off

To make every package use Jest, regardless of its `testCommand`, set this in `.build-raptor.json`:

```json
{
  "repoProtocol": {
    "enableCustomTestCommands": false
  }
}
```

The default is `true`.

## Reference

- Implementation: `getTestCommand()` and `runCustomTest()` in `modules/yarn-repo-protocol/src/yarn-repo-protocol.ts`
- Tests: `modules/yarn-repo-protocol/tests/custom-test-command.spec.ts`
- Example runners: `examples/test-runners/`
