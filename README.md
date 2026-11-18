# BD Modder 1.2.2

支持 Windows x64 和 macOS Apple Silicon（ARM64）的 MOD 图集编辑器，使用 Electron 和 Spine WebGL 4.1，提供标准 / 图集对照工作区。

## 启动

- 从源码启动：安装依赖后运行 `npm start`。
- 在 Windows 上运行 `BD-Modder-1.2.2-win-x64.exe`。若从 `win-unpacked` 启动，需保留整个目录。
- 在装有 macOS 13 或更新版本的 Apple 芯片 Mac 上，打开 `BD-Modder-1.2.2-mac-arm64.dmg`，将 `BD Modder.app` 拖入「应用程序」，再从「应用程序」启动。
- 运行打包版不需要另外安装 Node.js 或 .NET。
- 打开素材 → 选择 MOD 文件夹、.modfile 或 ZIP。当前支持 Spine 4.1 的完整素材，根目录需要一份 atlas、一份 skel 或骨骼 JSON，以及对应 PNG / PNG.bytes 图集。

## 1.2 隐藏部件

选择一个或多个部件后按 H，或在左侧部件上右键选择“隐藏选中部件”。角色预览隐藏这些部件，图集沿部件 UV 网格灰显，无网格时按贴图的非透明像素灰显。右键“显示隐藏部件”或检查器“显示部件”恢复显示，保留调色和替换结果。隐藏和显示均可撤销 / 重做。H 可以在设置 → 快捷键中修改。

普通保存会将隐藏记录写入 .bdmodder-editor.json，保留工作贴图以便以后恢复。导出 MOD ZIP、另存为 MOD 文件夹、导出图集或部件 PNG 时，按同一轮廓清除隐藏部件的 RGBA 像素，保留图集尺寸、atlas 坐标与骨骼引用。编辑器隐藏记录和备份不会进入导出包。另存的成品已清除隐藏像素，需要恢复时请使用原工作项目。

右键选择“只看选中部件”可临时隔离角色预览。菜单和角色画布上的“恢复完整预览”均可退出。

## 1.1 界面更新

右上角“设置”打开独立页面，左侧提供常规、快捷键、AI 绘图、项目与文件、关于分类。主题、密度、工作区和网点选项集中在常规中；快捷键可以修改并自动保存，冲突会显示提示。AI 服务地址、密钥和工作流入口集中在 AI 绘图。

动画与皮肤选择位于“角色预览 / 贴图图集”右侧，播放按钮、进度条、时间、速度和缩放共用一行。

## 已实现

- 原始图集实时 WebGL 动画、皮肤切换、播放暂停、逐帧和时间轴拖动、速度设置。
- 按屏幕像素密度调整绘制尺寸；预览放大无固定倍率上限。角色和图集分别支持缩放、拖动、适应。
- 标准 / 图集对照；两种模式都能打开检查器。
- 角色按三角网格、裁剪和纹理 Alpha 点选。图集按部件 UV 网格和纹理 Alpha 点选，可与角色同步定位。角色和图集都沿选中部件的可见边缘描绘轮廓。支持部件搜索、当前姿态 / 全部 / 已选筛选、Ctrl 多选、Shift 区间选择和网格显示。
- 支持部件着色、隐藏（含左侧“已隐藏”分类）、从本次打开时的原图还原、替换 PNG 和导出，也支持整张图集替换与导出。还原贴图按部件 UV 网格写入，无网格时使用原图的非透明像素。单个部件按原尺寸和图集方向导出，UV 网格外透明。替换 PNG 时只写入网格内原贴图和导入图都可见的像素。多选时将当前帧可见的部件按原始骨骼比例合成到透明 PNG，画布按需从 1024、2048、4096、8192 像素中选取最小能容纳选区的边长。
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
- Ctrl+Z 撤销，Ctrl+Shift+Z 重做，H 隐藏选中部件，Ctrl+D 清空选择。
- Space 播放暂停，F 切换标准 / 图集对照，0 适应当前画布，/ 搜索部件。
- 普通滚轮用于画布缩放；拖动平移。


## 局部重绘

在部件列表中选择同一张图集上的部件，停在能看清目标的动画帧，打开检查器的「局部重绘」。填写修改要求并开始。项目会组装工作图、提交第一轮、用 UV 三角形回写，可关闭第二轮补绘，或根据实际缺口裁出原尺寸贴图提交第二轮。若启用第二轮补绘，会独立传入第一轮生成的组装图和黑白缺口遮罩。工作图在采样时放大两倍，回写前按裙片轮廓校准取色位置，再用原尺寸遮罩限定写入。完成后角色会播放 `idle`，可以切换原图和结果并在确认后应用。

「UV 回写与蒙版」可选择写回通道。默认的「仅写回 RGB」保留图集透明度。「写回 ARGB」使用成图的 Alpha 写回直接取样的像素。纯 RGB 成图、交界共用取色和近邻补色保留目标像素的透明度。

内置工作流使用 [RunningHub 原生 ComfyUI 入口](https://www.runninghub.ai/runninghub-api-doc-en/doc-8287466)提交完整节点图。在「设置 → AI 绘图」中可以为多个 RunningHub API Key 命名并加密保存。切换启用的密钥后，新的连接测试和重绘任务会使用所选密钥。本案例通过国际站地址 `https://www.runninghub.ai/` 验证。第一轮使用 Qwen Image Edit Plus，第二轮使用 Qwen Image 2.1；对应模型与节点依赖需分别准备。

在本地 ComfyUI 中打开下面两份画布版，可用「文件 → 打开」或直接拖入画布。画布版含节点位置与连线。原有 API JSON 供 BD Modder 提交任务，较旧的导入器可能无法将它还原为画布。 [ComfyUI 工作流格式](https://docs.comfy.org/development/api-development/workflow-api-format)

| 轮次 | 本地 ComfyUI 画布版 | BD Modder API 版 |
| --- | --- | --- |
| 第一轮 · 组装图重绘（Qwen Image Edit Plus） | [打开画布 JSON](app/workflows/local-repaint-assembled.qwen21.canvas.json) | [API JSON](app/workflows/local-repaint-assembled.qwen21.json) |
| 第二轮 · 原尺寸 UV 补绘（Qwen Image 2.1） | [打开画布 JSON](app/workflows/local-repaint-uv.qwen21.canvas.json) | [API JSON](app/workflows/local-repaint-uv.qwen21.json) |

第二轮读取编辑目标的宽高，用 `round(sqrt(宽 × 高))` 设置 `TextEncodeQwenImage21` 的 `resolution`，并读取放大两倍后的 UV 工作图。第一轮使用 `TextEncodeQwenImageEditPlus` 编码裁切后的组装图；程序把修改要求写入提示词节点。

本地 ComfyUI 需要包含第一轮的 `TextEncodeQwenImageEditPlus`、`InpaintCropImproved`、`InpaintStitchImproved` 等节点，以及第二轮的 `TextEncodeQwenImage21`、`GetImageSize` 和 `ComfyMathExpression`。模型准备好后，第一轮选择 `round-1-input.png`；第二轮分别选择 `round-2-input.png`、`round-2-model-mask.png` 和上一轮生成的 `round-1-output.png`（独立参考图）。PNG 可从 BD Modder 对应任务的 `jobs` 目录获取。 [Qwen Image 2.1 官方模板与依赖](https://docs.comfy.org/tutorials/image/qwen/qwen-image-2-1)

第一轮需要将 `qwnImageEdit_v16Bf16.safetensors` 放入 `models/diffusion_models`，将 `qwen_2.5_vl_7b_fp8_scaled.safetensors` 放入 `models/text_encoders`，将 `qwen_image_vae.safetensors` 放入 `models/vae`。第二轮需要将 `redqw21UNLOCKEDV2TI2I_redqw21UNLOCKEDV2_int8.safetensors` 放入 `models/diffusion_models`，将 `qwen3vl_8b_int8_convrot.safetensors` 放入 `models/text_encoders`，将 `qwen_image_2.1_vae_bf16.safetensors` 放入 `models/vae`。两轮的提示词都由 BD Modder 修改要求提供。第一轮 `mask_blend_pixels` 固定为 0。

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
