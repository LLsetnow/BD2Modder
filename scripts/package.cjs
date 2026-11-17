'use strict';
const { existsSync } = require('node:fs');
const path = require('node:path');

async function pack() {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const dirOnly = process.argv.includes('--dir');
  if (!isMac && (process.argv.includes('--mac') || !isWindows)) {
    throw Error('请在 macOS 上运行 npm run dist:mac，或在 Windows 上运行 npm run dist 构建便携版。');
  }

  if (isWindows) {
    const systemRoot = process.env.SystemRoot || 'C:/Windows';
    process.env.PATH = [path.dirname(process.execPath), path.join(systemRoot, 'System32'), path.join(systemRoot, 'System32/WindowsPowerShell/v1.0'), systemRoot].join(path.delimiter);
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  }

  require('./build.cjs');
  const { build, Platform, Arch } = require('electron-builder');
  const projectDir = path.resolve(__dirname, '..');
  const platform = isMac ? Platform.MAC : Platform.WINDOWS;
  const target = dirOnly ? 'dir' : isMac ? 'dmg' : 'portable';
  const arch = isMac ? Arch.arm64 : Arch.x64;
  const config = {};

  const electronDist = path.join(projectDir, 'node_modules/electron/dist');
  if (isWindows && process.arch === 'x64' && existsSync(path.join(electronDist, 'electron.exe'))) {
    config.electronDist = electronDist;
  }
  if (isMac && !process.env.CSC_LINK && !process.env.CSC_NAME) {
    config.mac = { identity: '-', hardenedRuntime: false, notarize: false };
  }

  const files = await build({ projectDir, targets: platform.createTarget(target, arch), config, publish: 'never' });
  console.log(JSON.stringify(files));
}

pack().catch(error => { console.error(error); process.exitCode = 1; });
