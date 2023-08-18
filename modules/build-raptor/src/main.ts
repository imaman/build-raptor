#!/usr/bin/env -S node --enable-source-maps
import { main } from './build-raptor-cli'

// Needed for import-time symlinking
// TODO(imaman): find a solution that is transparent for the user code.
export * from './index'

main()
