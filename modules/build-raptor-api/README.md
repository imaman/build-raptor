## build-raptor-api

definitions that allow external software to interact with build-raptor. At the moment (June 2023) the interaction type that is supported is intpection of build steps that are reported to the `step-by-step.json` file.

> **Warning**
> when this module is published (via the [publish-to-npm](../../publish-to-npm) script) This module is packed as-is, without any transitive dependencies. This means that this module cannot depend on other modules from this repository.
