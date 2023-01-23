#!/bin/bash

# we suppress most of build-raptor's pack-all behavior due to a webpack issue
cp src/a.js pack/main.js
cd pack

V=$(npm pkg get version | tr -d '"')
npm pkg set "dependencies.jest-reporter-impl=$V"

