#!/bin/bash
# Example custom test runner for Vitest
# Arguments: $1=package_dir, $2=package_name, $3=rerun_file

cd "$1"
npx vitest run --reporter=json --outputFile="$3"
exit_code=$?

# Convert vitest output to build-raptor format if needed
# (This is optional - build-raptor only cares about exit code)

exit $exit_code