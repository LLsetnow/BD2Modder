'use strict';
// End-to-end file verification always edits a fresh copy, never the supplied MOD.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Project, importZip } = require('../app/project.cjs');
async function main() {
  const source = process.argv[2]; if (!source) throw Error('Pass the path of a complete Spine 4.1 MOD.');
  const original = new Project(source); await original.load();
  const hashes = async p => Object.fromEntries(await Promise.all(p.files.map(async name => [name, crypto.createHash('sha256').update(await fs.readFile(path.join(p.root, name))).digest('hex')])));
  const baseline = await hashes(original), folder = path.resolve(__dirname, '../.test-output/roundtrip-' + Date.now()), clone = path.join(folder, 'MOD-副本');
  await fs.mkdir(folder, { recursive: true }); await fs.cp(original.root, clone, { recursive: true, errorOnExist: true, force: false });
  const p = new Project(clone); await p.load(); const spine = await import('@esotericsoftware/spine-core'); const atlas = new spine.TextureAtlas(p.atlasText);
  const r = atlas.regions.find(r => /face/i.test(r.name)) || atlas.regions[0];
  const rect = { x: r.x, y: r.y, width: r.degrees % 180 ? r.height : r.width, height: r.degrees % 180 ? r.width : r.height };
  await p.mutate(r.page.name, 'tint', [rect], { color: '#0088ff', strength: 1 }); if (!p.dirty()) throw Error('Edit did not change the source.');
  const saved = await p.save(); if (p.dirty() || !saved.backup) throw Error('Save/backup did not complete.');
  p.undo(); if (!p.dirty()) throw Error('Undo after save did not mark the MOD modified.'); await p.save();
  if (JSON.stringify(await hashes(p)) !== JSON.stringify(baseline)) throw Error('Undo/save failed to restore identical source files.');
  const zipFile = path.join(folder, 'MOD-导出.zip'); await fs.writeFile(zipFile, await p.zip()); const imported = await importZip(zipFile, path.join(folder, 'imports'));
  if (JSON.stringify(await hashes(imported)) !== JSON.stringify(baseline)) throw Error('ZIP roundtrip changed the MOD contents.');
  if (JSON.stringify(await hashes(original)) !== JSON.stringify(baseline)) throw Error('Original MOD changed.');
  const report = { passed: true, sourceFiles: p.files.length, atlasPages: p.pages.size, editedRegion: r.name, savedWithBackup: true, undoRestoredIdenticalFiles: true, zipRoundtripIdentical: true, originalUnchanged: true, zipBytes: (await fs.stat(zipFile)).size, output: folder, finishedAt: new Date().toISOString() };
  await fs.writeFile(path.resolve(__dirname, '../docs/real-mod-roundtrip.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
