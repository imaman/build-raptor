# build-raptor

## Development

One of build-raptor's main features (with yarn-repo-protocol) is its ability to auto-generate the `tscofnig.json` files for all the modules. However, in build-raptor's own code, we must have these files committed into the source control system, otherwise we would not be able to bootstrap build-raptor (although build-raptor is capable of building itself, before the first compilation is taking place we must first build it with `tsc` so we must have the `tsconfig.json` files present at that point).
