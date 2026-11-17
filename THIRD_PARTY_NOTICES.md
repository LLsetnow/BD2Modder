# BD Modder third-party components

This local development project follows the user's existing ModStudio editing workflow. The recovered C# sources are retained separately in `../ModStudio-analysis/source/ModEditor` for reference; the Electron runtime, file operations and frontend in this directory are JavaScript source.

- Electron 45.3.3 — MIT, https://github.com/electron/electron. The packaged runtime contains Chromium, Node.js and its own LICENSES.chromium.html.
- Spine TypeScript runtime 4.1.56 — Spine Runtimes License Agreement, https://github.com/EsotericSoftware/spine-runtimes/tree/4.1. The dependency's license is included with this application. Integration and redistribution are subject to that license.
- pngjs 7.0.0 — MIT, https://github.com/pngjs/pngjs.
- fflate 0.8.3 — MIT, https://github.com/101arrowz/fflate.
- esbuild — MIT, https://github.com/evanw/esbuild (build tool).
- electron-builder — MIT, https://github.com/electron-userland/electron-builder (build tool).

The compressed MOD texture reader implements the documented LZ4 block and K4os Pickle V0 container formats. Format reference: https://github.com/MiloszKrajewski/K4os.Compression.LZ4/blob/master/src/K4os.Compression.LZ4/LZ4Pickler.pickle.cs.

User MOD artwork, skeletons, original game DLLs and credentials are not included in the distributable. MOD assets remain the property of their respective creators.
