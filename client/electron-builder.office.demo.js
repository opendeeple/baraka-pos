// Demo Office installer: run `build:office:demo` first, then `package:office:demo`.
module.exports = require('./scripts/demo-installer')(require('./electron-builder.office.json'), 'dist-office-demo')
