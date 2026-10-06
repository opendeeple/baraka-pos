// Turns a real electron-builder config into its demo twin (used by
// electron-builder.demo.js / electron-builder.office.demo.js): own appId,
// name and output dir, so a demo installs next to the real app, not over it.
//
// No nsis.include: resources/installer.nsh's uninstall step offers to delete
// %APPDATA%\baraka-pos, which is the REAL app's data, not the demo's.
module.exports = function demoInstaller(base, output) {
  const { include: _realAppUninstall, ...nsis } = base.nsis
  const name = `${base.productName} Demo`
  return {
    ...base,
    appId: `${base.appId}.demo`,
    productName: name,
    directories: { ...base.directories, output },
    win: { ...base.win, artifactName: base.win.artifactName.replace('-${version}', '-Demo-${version}') },
    nsis: { ...nsis, shortcutName: name, uninstallDisplayName: name },
  }
}
