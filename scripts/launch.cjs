'use strict';
const cp = require('node:child_process');
const path = require('node:path');
const electron = require('electron');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = cp.spawn(electron, [path.resolve(__dirname, '..'), ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: false });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
