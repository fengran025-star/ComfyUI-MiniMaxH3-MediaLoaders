# ComfyUI MiniMax H3 Media Loaders

[中文说明](#中文说明) · [English](#english)

> A modified distribution of [nkxx188/ComfyUI-MiniMaxH3-Easy](https://github.com/nkxx188/ComfyUI-MiniMaxH3-Easy), bundled with dedicated, unloadable image, video, and audio loaders for MiniMax H3 workflows.

## 中文说明

这是一个面向 MiniMax H3 工作流的整合式 ComfyUI 自定义节点包。它以 **nkxx188** 的 [ComfyUI-MiniMaxH3-Easy](https://github.com/nkxx188/ComfyUI-MiniMaxH3-Easy) 为上游基础，并将 H3 Easy 与专用媒体加载器打包到一个可直接安装的插件目录中。

### 功能

- 保留 H3 Easy 的文生视频、图生视频、首尾帧、参考视频、统一 Media 输入和 `@` 媒体引用编辑器。
- 提供统一分类 `MiniMax H3 文件加载器`：
  - `MiniMax H3 图片加载器`
  - `MiniMax H3 视频加载器`
  - `MiniMax H3 音频加载器`
  - `MiniMax H3 视频分辨率与帧率控制器`
- 图片、音频、视频均支持显式卸载；卸载后的素材不会作为 H3 Media 的有效参考素材。
- 音频和视频加载器支持指定 `ComfyUI/input` 子文件夹、刷新列表、上传、预览与裁剪。
- 视频控制器支持按比例缩放或限制最大边，并在重采样时保持视频时长及音频轨道。
- H3 `@` 菜单会按有效媒体显示；音频以文件名显示，已卸载或隐藏的直接加载器素材会被过滤。

### 安装

将整个目录复制或克隆到：

```text
ComfyUI/custom_nodes/ComfyUI-MiniMaxH3-MediaLoaders
```

然后重启 ComfyUI。MiniMax H3 模型仍按上游说明放入标准的 ComfyUI 模型目录。

### 重要说明

- 这是第三方上游项目的修改版，不是 nkxx188 的官方发布版本。
- MiniMax H3 的 H3 Easy 基础代码、统一多媒体输入和 `@` 编辑器设计归上游作者 **nkxx188** 所有；完整上游说明保存在 [UPSTREAM_README.md](UPSTREAM_README.md) 与 [UPSTREAM_README_CN.md](UPSTREAM_README_CN.md)。
- 上游采用 MIT License；本仓库保留原始 [LICENSE](LICENSE) 和版权声明。
- H3 输出 FPS 建议保持 **24**。本视频控制器可处理输入视频帧率，但不应将 H3 主节点的内部 FPS 改为非 24。

### 本修改版的变更

1. 增加图片、视频、音频文件加载器与统一的 `MiniMax H3 文件加载器` 分类。
2. 增加图片/视频/音频卸载状态，并将其接入 H3 Media 有效性过滤。
3. 增加音频和视频子文件夹、上传、刷新、预览、裁剪与素材信息界面。
4. 增加视频分辨率与帧率控制器：比例缩放、最大边限制、帧率重采样和音频保留。
5. 改进 H3 媒体选择菜单：音频文件名显示、无效媒体过滤、菜单布局调整。
6. 修复视频下拉预览对输入子文件夹路径的识别。

## English

This is an integrated ComfyUI custom-node package for MiniMax H3 workflows. It is a **modified distribution** based on **nkxx188**'s [ComfyUI-MiniMaxH3-Easy](https://github.com/nkxx188/ComfyUI-MiniMaxH3-Easy), bundled with dedicated media loaders in one installable directory.

### Features

- Keeps H3 Easy's text-to-video, image-to-video, first/last-frame, reference-video, unified Media input, and `@` media-reference editor.
- Adds one `MiniMax H3 文件加载器` category containing:
  - `MiniMax H3 图片加载器`
  - `MiniMax H3 视频加载器`
  - `MiniMax H3 音频加载器`
  - `MiniMax H3 视频分辨率与帧率控制器`
- Image, audio, and video sources can be explicitly unloaded. Unloaded sources are excluded from effective H3 Media references.
- Audio and video loaders support a chosen `ComfyUI/input` subfolder, refresh, upload, preview, and trimming.
- The video controller supports proportional scaling or a longest-edge limit while preserving duration and audio during frame-rate resampling.
- The H3 `@` menu lists effective media, uses filenames for audio labels, and filters directly connected unloaded or hidden loader sources.

### Installation

Copy or clone this entire directory to:

```text
ComfyUI/custom_nodes/ComfyUI-MiniMaxH3-MediaLoaders
```

Restart ComfyUI afterwards. Place MiniMax H3 models in the standard ComfyUI model folders as documented upstream.

### Attribution and license

- This is not an official nkxx188 release.
- The MiniMax H3 Easy base implementation, unified multi-media input, and `@` editor design are by **nkxx188**. See [UPSTREAM_README.md](UPSTREAM_README.md), [UPSTREAM_README_CN.md](UPSTREAM_README_CN.md), and the upstream repository: [nkxx188/ComfyUI-MiniMaxH3-Easy](https://github.com/nkxx188/ComfyUI-MiniMaxH3-Easy).
- The upstream project is MIT licensed. Its original [LICENSE](LICENSE) and copyright notice are retained.
- Keep H3 Easy's internal output FPS at **24**. The bundled controller may resample input-video FPS, but the H3 main node should not be set to a different internal FPS.

### Changes in this distribution

1. Added dedicated image, video, and audio loaders plus a unified media-loader category.
2. Added unload states for image/video/audio and connected them to H3 Media validity filtering.
3. Added subfolder selection, upload, refresh, preview, trimming, and media information for audio/video loaders.
4. Added video resolution and frame-rate control with scale mode, longest-edge mode, frame resampling, and audio retention.
5. Refined the H3 media picker with filename labels for audio, invalid-media filtering, and compact popup layout.
6. Fixed video dropdown previews for files stored in input subfolders.

## License

MIT. See [LICENSE](LICENSE). The original upstream copyright notice must remain in all substantial copies.
