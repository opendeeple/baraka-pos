// Demo POS installer: run `build:demo` first, then `package:demo`.
module.exports = require('./scripts/demo-installer')(require('./package.json').build, 'dist-demo')
