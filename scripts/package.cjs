'use strict';
const path = require('node:path');
process.env.PATH = [path.dirname(process.execPath), path.join(process.env.SystemRoot || 'C:/Windows', 'System32'), path.join(process.env.SystemRoot || 'C:/Windows', 'System32/WindowsPowerShell/v1.0'), process.env.SystemRoot || 'C:/Windows'].join(';');
process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
require('./build.cjs');
const { build, Platform, Arch } = require('electron-builder');
build({ projectDir: path.resolve(__dirname, '..'), targets: Platform.WINDOWS.createTarget(process.argv.includes('--dir') ? 'dir' : 'portable', Arch.x64), config: { electronDist: path.resolve(__dirname, '../node_modules/electron/dist') } }).then(files => console.log(JSON.stringify(files))).catch(error => { console.error(error); process.exitCode = 1; });
