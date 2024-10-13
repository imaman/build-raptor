## build-raptor-api

This module provides definitions that enable external software to interact with build-raptor. As of October 2024, there are two interaction modes, which can be used independently or in combination:

1. Registering a [StepByStepProcessor](src/step-by-step-processor.ts) module using the `--step-by-step-processor` command line option.
2. Reading the steps from the `step-by-step.json` file after the build run has completed.

> **Warning**
> When this module is published (via the [publish-to-npm](../../publish-to-npm) script), it is packaged as-is, without any transitive dependencies. As a result, this module cannot depend on other modules from this repository.
