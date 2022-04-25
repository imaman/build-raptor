const path = require('path');

const inrepo = [
  "actions-cache-storage-client",
  "brand",
  "build-failed-error",
  "build-raptor-action",
  "build-raptor-core",
  "build-raptor",
  "build-run-id",
  "logger",
  "misc",
  "paths",
  "repo-protocol",
  "task-name",
  "unit-metadata",
  "yarn-repo-protocol"
]

module.exports = {
  entry: './dist/src/index.js',
  output: {
    filename: 'packed.js',
    path: path.resolve(__dirname, 'prepare-pack'),
  },
  mode: "development",
  externals: [
    function ({ _context, request }, callback) {
      let decision = 'R'
      if (request.startsWith('.')) {
        decision = 'bundle';
      }
      
      if (inrepo.includes(request)) {
        decision = 'bundle'
      }
      
      if (decision === 'bundle') {
        callback()
      } else {
        callback(null, 'commonjs ' + request)
      }      
    }
  ]
};

