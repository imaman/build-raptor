# build-raptor

## User Manual

### Build Tasks

build-raptor super-efficiently builds monorepos by caching build outputs from earlier runs. At its core it manages a list of _tasks_. A task is executed only if its outputs are not found in cache, that is: only if its input where never "seen" before (at earlier runs).

The scope of things that a task can carry out is very broad. A task can do a compilation step, it can run tests, it can lint, it can package, what have you. In addition to preset tasks, repo-defined tasks allow each using repo to customize the build as it needs.

Conceptually, a task definition looks as follows:

- inputs: a list of files which the task needs. These are either source files or outputs of other tasks.
- outputs: a list of files which this task produces.
- the command to run
- labels: an optional list of string to allow flexibility in selecting the tasks to run (for instance, to separate between slow tests and fast running tests).

Here is an example for such a definition (in a `package.json` file):

```
{
  "name": "my-module"
  "author": "alice",
  "license": "MIT",
  "scripts": {
    "do-kramer": "echo 'pretzels' > .out/kramer",
  },
  "buildTasks": {
    "do-kramer": {
      "inputs": [ "dist/george.js", "dist/elaine.js" ],
      "outputs": [ ".out/kramer" ],
      "labels": [ "seinfeld" ],
    }
  }
}
```

This means that the `do-kremer` run script will be invoked after `dist/george.js` and `dist/elaine.js` have been built and their content is new (has not been seen in earlier runs).

A task can define _public outputs_: these are files which will be stored as-is in the persistent storage using content hashing (AKA: content addressable storage). The hash of these files will be reflected in the [step-by-step reporting](#step-by-step-reporting). This will allow other system to access these outputs.

```
{
  "name": "my-module"
  "author": "alice",
  "license": "MIT",
  "scripts": {
    "do-kramer": "echo 'pretzels' > .out/kramer",
  },
  "buildTasks": {
    "do-kramer": {
      "inputs": [ "dist/george.js", "dist/elaine.js" ],
      "publicOutputs": [ ".out/kramer" ],
      "labels": [ "seinfeld" ],
    }
  }
```

The specail value `'_ALWAYS_'` can be used (as the value of the `inputs` attribute) to define a task which always runs (i.e., has no inputs to wait for, always runs at the beginning of the build):

```
{
  ...
  "buildTasks": {
    "do-kramer": {
      "inputs": [],
      "outputs": "_ALWAYS_",
      "labels": [ "seinfeld" ],
    }
  }
}
```

### Configuration

When a build statrs build-raptor loads its configuraiton from a `.build-raptor.json` file located at the root directory. This location can be changed via the `--config-file` command line option. The zod-schema of this file can be found at [build-raptor-config.ts](modules/build-raptor-core/src/build-raptor-config.ts).

### Log, outputs

when a build run starts, build raptor creates a `.build-raptor` directory at the root directory. All log messages produced by build-raptor itself will be placed in the `.build-raptor/main.log` file in that directory.

Additionally, there are outputs produced by the different build tasks that were executed during that build runs (compiler outputs, test runner outputs, etc.). These are placed in per-task files which are saved at `.build-raptor/tasks` directory.

### Step-by-Step reporting

As build raptor is running it produces JSON object describing various build events. The zod-schema of these JSON objects can be found in [build-raptor-api.ts](modules/build-raptor-api/src/build-raptor-api.ts). This allows other tools to get a details view of the build run, interact with outputs that were produced, etc.

To get these events in real-time (while the build is running) one should define a node module (e.g., `my-processor`) and pass the name of that module to the `--step-by-step-processor` command (i.e., `--step-by-step-processor=my-processor`) line option. This module should look as follows:

```typescript
import {Step, StepByStepProcessor} from 'build-raptor-api'
export const processor: StepByStepProcessor = (s: Step) => {
  // place your own custom logic here...
  console.log(`received: ${JSON.stringify(s)})
}
```

The `processor` definition is mandatory: build-raptor expects that module to export a function called `processor` - the build will fail to start if that's not case.

### Custom Test Runners

Build Raptor supports custom test execution programs as an alternative to the default Jest runner. This allows you to use Vitest, Mocha, Playwright, or any other test framework while maintaining Build Raptor's caching and parallelization benefits.

To use a custom test runner, add a `testCommand` field to your package.json's `buildRaptor` configuration:

```json
{
  "name": "@myrepo/my-package",
  "buildRaptor": {
    "testCommand": "tools/test-runners/vitest.sh"
  }
}
```

The test command receives the package directory, package name, and rerun file path as arguments. See [CUSTOM_TEST_RUNNERS.md](docs/CUSTOM_TEST_RUNNERS.md) for detailed documentation and examples.

### goals and labels

### Command line

### Caching

## Development

One of build-raptor's main features (with yarn-repo-protocol) is its ability to auto-generate the `tscofnig.json` files for all the modules. However, in build-raptor's own code, we must have these files committed into the source control system, otherwise we would not be able to bootstrap build-raptor (although build-raptor is capable of building itself, before the first compilation is taking place we must first build it with `tsc` so we must have the `tsconfig.json` files present at that point).
