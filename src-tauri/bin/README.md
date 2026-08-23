# src-tauri/bin

此目录存放随应用捆绑的 **yt-dlp 独立二进制**（sidecar），使打包后的应用无需用户安装 yt-dlp / Python / Node 即可搜索和播放。

Tauri 的 `bundle.externalBin`（`tauri.conf.json`）会按 target-triple 查找二进制，命名规则：

| 平台 | 文件名 |
|------|--------|
| Windows x64 | `yt-dlp-x86_64-pc-windows-msvc.exe` |
| macOS ARM64 | `yt-dlp-aarch64-apple-darwin` |
| macOS x86_64 | `yt-dlp-x86_64-apple-darwin` |

**这些二进制体积较大（约 17~37 MB），已加入 `.gitignore` 不入库**，由 CI 在构建时自动从 yt-dlp GitHub Release 下载并重命名（见 `.github/workflows/build.yml`）。

本地手动构建时可自行下载：

```bash
# macOS (Apple Silicon / CI macos-latest 均为 arm64)
curl -L -o src-tauri/bin/yt-dlp-aarch64-apple-darwin \
  https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos
chmod +x src-tauri/bin/yt-dlp-aarch64-apple-darwin
```
