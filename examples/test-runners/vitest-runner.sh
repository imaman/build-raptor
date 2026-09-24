#!/bin/bash
# Example custom test runner for Vitest
# Arguments: $1=package_dir, $2=package_name, $3=rerun_file (unused here)
# build-raptor only cares about the exit code.

cd "$1"
npx vitest run
