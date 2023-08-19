#!/usr/bin/env -S node --enable-source-maps

// Needed for import-time symlinking. Must appear before every other import.
// TODO(imaman): find a solution that is transparent for the user code.
export * from './index'

import { main } from './build-raptor-cli'

main()
