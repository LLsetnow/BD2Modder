# BD Modder 1.2.2

支持 Windows x64 和 macOS Apple Silicon（ARM64）的 MOD 图集编辑器，使用 Electron 和 Spine WebGL 4.1，提供标准 / 图集对照工作区。

## 启动

- 从源码启动：安装依赖后运行 `npm start`。
- 在 Windows 上运行 `BD-Modder-1.2.2-win-x64.exe`。若从 `win-unpacked` 启动，需保留整个目录。
- 在装有 macOS 13 或更新版本的 Apple 芯片 Mac 上，打开 `BD-Modder-1.2.2-mac-arm64.dmg`，将 `BD Modder.app` 拖入「应用程序」，再从「应用程序」启动。
- 运行打包版不需要另外安装 Node.js 或 .NET。
- 打开素材 → 选择 MOD 文件夹、.modfile 或 ZIP。当前支持 Spine 4.1 的完整素材，根目录需要一份 atlas、一份 skel 或骨骼 JSON，以及对应 PNG / PNG.bytes 图集。

## 1.2 隐藏部件

选择一个或多个部件后按 H，或在左侧部件上右键选择“隐藏选中部件”。角色实时预览隐藏这些部件，左侧缩略图与图集区域变灰。右键“显示隐藏部件”或检查器“显示部件”恢复显示，保留调色和替换结果。隐藏和显示均可撤销 / 重做；H 可以在设置 → 快捷键中修改。

普通保存会将隐藏记录写入 .bdmodder-editor.json，保留工作贴图以便以后恢复。导出 MOD ZIP、另存为 MOD 文件夹、导出图集或部件 PNG 时，将隐藏部件覆盖区域的 RGBA 全部清零；保留图集尺寸、atlas 坐标与骨骼引用。编辑器隐藏记录和备份不会进入导出包。另存的成品已清除隐藏像素，需要恢复时请使用原工作项目。

## 1.1 界面更新

右上角“设置”打开独立页面，左侧提供常规、快捷键、AI 绘图、项目与文件、关于分类。主题、密度、工作区和网点选项集中在常规中；快捷键可以修改并自动保存，冲突会显示提示。AI 服务地址、密钥和工作流入口集中在 AI 绘图。

动画与皮肤选择位于“角色预览 / 贴图图集”右侧，播放按钮、进度条、时间、速度和缩放共用一行。

## 已实现

- 原始图集实时 WebGL 动画、皮肤切换、播放暂停、逐帧和时间轴拖动、速度设置。
- 按屏幕像素密度调整绘制尺寸；预览放大无固定倍率上限。角色和图集分别支持缩放、拖动、适应。
- 标准 / 图集对照；两种模式都能打开检查器。
- 角色按三角网格、裁剪和纹理 Alpha 点选，图集同步定位，部件搜索、当前姿态 / 全部 / 已选筛选、Ctrl 多选、网格和选区边框。
- 部件着色、隐藏（含左侧“已隐藏”分类）、从本次打开时的原图还原、替换 PNG、导出部件；整张图集替换与导出。部件 PNG 使用图集中存储的方向，旋转角度显示在检查器中。
- 撤销 / 重做、modfile JSON 配置编辑、原目录保存、另存为完整 MOD 文件夹、MOD ZIP 和透明预览 PNG 导出。
- 保存前检查外部修改，保存时自动备份到原 MOD 下的 .bdmodder-backups。原素材在点击保存前不改动；ZIP 项目需要另存为。
- ComfyUI 和 RunningHub 的工作流导入、节点映射、连接测试、图集局部重绘、进度、停止等待、结果预览后应用。
- 最近项目、暗色 / 浅色、密度、网点和布局偏好；通过 Windows 系统加密或 macOS 钥匙串保护云端密钥。

## 重绘服务

在检查器 AI 重绘中设置服务连接，导入 ComfyUI API 格式 JSON 或原版 .redraw.json。映射图集输入、独立遮罩、修改要求和图片输出节点；LoadImageMask 使用 red 通道。使用 RunningHub 时填写工作流 ID 和 API Key。不会预装或猜测用户的模型。

目前重绘以当前图集页为输入；一次选择同一页上的部件。输出 PNG 需要与图集尺寸一致。结果只应用到选区，并保留原始 Alpha；其余区域保持原样。服务配置的测试只检查连接，生成按钮才提交任务。停止等待不会保证远程任务终止；已提交的任务 ID 存在用户配置目录 jobs 下，请查看服务端记录后再重试。

## 快捷键

macOS 使用 Command（⌘）对应下列 Ctrl 快捷键。按住 Command 点击可多选部件。

- Ctrl+O 打开，Ctrl+S 保存，Ctrl+Shift+S 另存为，Ctrl+E 导出。
- Ctrl+Z 撤销，Ctrl+Shift+Z 重做，H 隐藏选中部件。
- Space 播放暂停，F 切换标准 / 图集对照，0 适应当前画布，/ 搜索部件。
- 普通滚轮用于画布缩放；拖动平移。

## 开发和构建

源码目录 app/ 为 Electron 主进程、preload、文件处理和工作流服务；renderer/ 为 HTML、CSS、前端和 Spine 渲染；tests/ 为自动检查。

安装 Node.js 22.12 或更新版本后：

~~~text
npm ci
npm run build
npm test
npm start
~~~

也可直接执行 `node scripts/launch.cjs --open 完整MOD目录`。

- 在 Windows 上运行 `npm run dist`，生成 `release/BD-Modder-1.2.2-win-x64.exe`。
- 在 macOS 上运行 `npm run dist:mac`，生成 `release/BD-Modder-1.2.2-mac-arm64.dmg`。本地测试构建默认使用临时签名（ad hoc）。分发时可提供 electron-builder 的 `CSC_LINK` 或 `CSC_NAME` 和 Apple 公证凭据。若受信任的测试包首次打开时被系统拦截，可在「系统设置 → 隐私与安全性」选择「仍要打开」。[Apple 的打开说明](https://support.apple.com/en-us/102445)
- 在任一支持的平台运行 `npm run pack`，生成对应的解包目录，便于调试。

原有 HTML 草案仍保留在 draft/，仅用于查看设计，其 720×720 静态图不代表桌面版的渲染。preview-server.cjs 继续提供局域网草案预览。

## 验证范围

自动检查覆盖 PNG / Unity 压缩纹理、局部编辑、撤销后保存状态、备份、外部修改保护、ZIP 路径与导出往返、密钥配置、ComfyUI / RunningHub 模拟请求，以及指定 Blade MOD 的所有四段真实 Spine 动画。没有用户服务配置时不会提交真实云端任务。

第三方组件和许可见 THIRD_PARTY_NOTICES.md。发行包不包含用户 MOD 素材、游戏 DLL 或任何密钥。
