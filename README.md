# build-raptor

## Usage

build-raptor super-efficiently builds monorepos by caching build outputs from earlier runs. At its core it manages a list of _tasks_. A task is executed only if its outputs are not found in cache, that is: only if its input where never "seen" before (at earlier runs).

The scope of things that a task can carry out is very broad. A task can do a compilation step, it can run tests, it can lint, it can package, what have you. In addition to preset tasks, repo-defined tasks allow each using repo to customize the build as it needs.

Conceptually, a task definition looks as follows:

- inputs: a list of files which the task needs. These are either source files or outputs of other tasks.
- outputs: a list of files which this task produces.
- the command to run
- labels: an optional list of string to allow flexibility in selecting the tasks to run (for instance, to separate between slow tests and fast running tests).

### goals and labels

### Command line

### Caching

## Development

One of build-raptor's main features (with yarn-repo-protocol) is its ability to auto-generate the `tscofnig.json` files for all the modules. However, in build-raptor's own code, we must have these files committed into the source control system, otherwise we would not be able to bootstrap build-raptor (although build-raptor is capable of building itself, before the first compilation is taking place we must first build it with `tsc` so we must have the `tsconfig.json` files present at that point).
