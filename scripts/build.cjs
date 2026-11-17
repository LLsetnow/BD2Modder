'use strict';
const path = require('node:path');
const esbuild = require('esbuild');
const fs = require('node:fs');
esbuild.buildSync({ entryPoints: [path.join(__dirname, '../renderer/app.js')], outfile: path.join(__dirname, '../renderer/bundle.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', sourcemap: true, minify: false, legalComments: 'eof' });
esbuild.buildSync({ entryPoints: [path.join(__dirname, '../renderer/settings-draft.js')], outfile: path.join(__dirname, '../draft/settings-bundle.js'), bundle: true, platform: 'browser', format: 'iife', target: 'chrome130', minify: false });
fs.copyFileSync(path.join(__dirname, '../renderer/settings.css'), path.join(__dirname, '../draft/settings.css'));
fs.copyFileSync(path.join(__dirname, '../renderer/visibility.css'), path.join(__dirname, '../draft/visibility.css'));
console.log('Built BD Modder renderer.');
