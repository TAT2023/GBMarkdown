# GBMarkdown

Windows 10/11 x64 本地只读 Markdown 阅读器。Rust Workspace + Tauri 2 + React/TypeScript，文件读取、结构索引和搜索全部在 Rust 层完成。

## 使用

Windows 安装包、离线安装包和便携版可从 [GitHub Releases](https://github.com/TAT2023/GBMarkdown/releases) 下载；0.4.0 新增 `\(...\)`、`\[...\]` 公式分隔符，标题栏和阅读区同步平滑切换主题；0.3.0 新增内部链接、阅读历史、代码与公式源码复制；0.2.0 新增数学公式渲染，0.1.0 保留首次发布功能。

构建产物位于 `release/`：

- `GBMarkdown-Portable-x64/GBMarkdown.exe`：直接运行；可将 Markdown 文件拖入窗口，也可把文件路径作为启动参数。
- `GBMarkdown-Portable-x64.zip`：便携版。
- `GBMarkdown-Setup-x64.exe`：当前用户 NSIS 安装包，提供文件关联，无需管理员权限。
- `GBMarkdown-Setup-x64-Offline.exe`：包含 WebView2 离线安装依赖的安装包。

便携版和普通安装版需要 WebView2 Runtime；普通安装版在运行时缺失时会联网下载。阅读器本身离线工作，不请求远程图片，不上传文档。

首次打开先显示一个有限阅读窗口，目录和结构索引随后在后台建立。底部进度条、目录和百分比输入框可跳转到全文任意位置。索引尚未覆盖的远距离位置先显示文本，完成后恢复结构渲染。

开发分支支持多文件标签：文件选择框可以多选，也可以一次拖入多个文件。单文档模式只显示当前标签；对比模式最多同时显示四份文档，两份左右排列，三至四份使用双列布局，窄窗口改为上下排列。标签旁的复选框选择对比文件，取消选择或移出对比不会关闭标签。点击阅读栏后，目录、搜索、状态栏和前进后退跟随该栏；各文件保留独立阅读位置、浏览历史和搜索条件。`Ctrl+Tab` / `Ctrl+Shift+Tab` 切换标签，`Ctrl+W` 关闭当前标签。桌面版重复打开同一路径会切回已有标签，打开失败不会关闭其他文件。

公式下方的水平滚动条默认隐藏，超宽公式仍可通过触控板、触屏或横向滚动访问全部内容，字号和 LaTeX 复制保持原样；长独立公式的两端都在滚动范围内。

数学公式支持 `$...$`、`\(...\)` 行内公式和 `$$...$$`、`\[...\]` 独立公式，包括分式、积分、矩阵和 `aligned` 多行对齐。Rust 识别公式后，前端按需加载 KaTeX；排版引擎和字体随程序本地打包，不依赖网络。代码块、行内代码和转义的分隔符保持原文。公式搜索命中会高亮整个公式，不修改其内部排版。新公式语法会使旧版磁盘索引重新构建，仍然优先显示首屏。

文档内 `[链接](#标题锚点)` 可跳转到全文标题，支持中文和 URL 编码。标题文字转小写、空白替换为 `-`、去掉格式与标点；重复标题依次使用 `-1`、`-2` 后缀，编号冲突继续递增。标题锚点保存在磁盘索引中；尚未扫描到的目标会等待索引，也可取消。原始 HTML 自定义锚点和跨文件 Markdown 链接暂不支持。

工具栏前进、后退按钮及 `Alt+Left/Right` 可恢复跳转前的阅读位置。内部链接、目录、搜索、百分比和文档首尾跳转共享每文档最多 200 条历史；切换标签保留历史，重新加载时清空对应文件的历史。桌面标题栏与阅读面板共享约 220 毫秒的颜色渐变，保持阅读位置，系统开启“减少动态效果”时直接切换。标题栏支持拖动、双击最大化，以及最小化、还原和关闭按钮。

代码块右上角的复制按钮保留代码缩进、换行及 Unicode；行内和独立公式旁的按钮复制 LaTeX 源码，不包含公式分隔符。复制不受高亮、搜索标记或公式排版影响。超大代码块按当前阅读片段复制，按钮提示为“复制当前代码片段”；无效公式仍可复制原始 LaTeX。成功显示勾号，失败可重试。

公式使用 KaTeX 支持的 TeX 语法；非法或过大的公式保留原始内容。单公式输入上限 4,096 个字符，每个阅读片段最多排版 128 个公式，累计输入不超过 16,384 个字符、输出 HTML 不超过 512×1024 个字符和 12,000 个元素。宏展开次数和尺寸也有上限，不允许公式创建可信 HTML 或外部资源。跨页超大独立公式使用兼容文本模式，结束后恢复正常 Markdown。

快捷键：`Ctrl+O` 打开，`Ctrl+F` 搜索，`Ctrl+G` 百分比跳转，`Ctrl+Home/End` 文档首尾，搜索框 `Enter/Shift+Enter` 下一个/上一个结果。主题、字号、侧边栏、窗口尺寸、最近 20 个文件及阅读位置会自动保存。

## 开发

要求 Node.js 22.12+、Rust stable MSVC、Visual Studio C++ Build Tools、Windows SDK 和 WebView2。Rust 工具链需在 PATH 中。

```powershell
npm ci
npm run desktop
```

单独预览界面：`npm run dev`，地址 `http://127.0.0.1:1420`。浏览器预览使用 File.slice 和有界文本窗口，默认打开示例文档。生产桌面版使用 Rust 引擎；浏览器预览不代表桌面版的 GB 级性能或完整编码支持。

```powershell
cargo test --workspace --exclude gbmarkdown
cargo clippy --workspace --all-targets -- -D warnings
npm run build
npm run test:ui
npm run test:math
npm run test:latex
npm run test:navigation
npm run test:copy
npm run test:theme
npm run test:documents
npm run tauri -- build --bundles nsis
./scripts/package.ps1
# 先保留普通安装包，再打包离线变体。
npm run tauri -- bundle --bundles nsis --config src-tauri/tauri.offline.conf.json
./scripts/package.ps1 -Offline
# 发布时可分别保存每个版本的产物。
./scripts/package.ps1 -Offline -OutputDirectory release/v0.4.0
```

UI 测试使用本机 Edge 无头模式。`tests/desktop.mjs` 连接专用于验收的 WebView2 调试端口 9229，验证实际 Tauri IPC、1 GiB 文档、跳转、搜索高亮和主题；正常应用不启用远程调试。

`tests/theme.mjs` 逐帧检查明暗颜色过渡、快速反向切换、阅读布局和减少动态效果设置；设置 `GBM_CDP_URL` 可连接已打开文档的专用原生验收窗口。

`tests/documents.mjs` 验证批量打开、五标签切换、四文件对比上限、独立历史、位置恢复、搜索隔离及长公式溢出。设置 `GBM_CDP_URL` 可连接专用原生验收窗口，额外验证真实文件索引、重复打开、文件变化与重新加载、关闭后句柄失效。测试会关闭该验收窗口内的已有文档，并在 `artifacts/documents` 生成小型测试文件。

设置 `GBM_CDP_URL` 与专用验收进程的 `GBM_QA_PID` 后，`node tests/window-controls.mjs` 检查桌面标题栏最大化、还原、双击、最小化与关闭；该测试会关闭验收窗口。

`tests/math.mjs` 默认测试浏览器公式渲染、搜索、字体、安全策略、预算及排版后滚动锚点；设置 `GBM_CDP_URL` 后可连接已打开 `tests/fixtures/math.md` 的原生验收窗口。

`node tests/navigation.mjs --fixture` 生成 `artifacts/navigation.md`；以该文件启动专用验收窗口后，设置 `GBM_CDP_URL` 可复测原生链接和历史。`tests/windows-theme.ps1 -ReaderProcessId <进程ID> -Theme dark -Screenshot artifacts/native-window-dark.png` 检查底层 Windows 窗口的暗色属性并截图，亮色用 `-Theme light`；可见标题栏与面板的同步由 `tests/theme.mjs` 检查。

发布目录的 `SHA256SUMS.txt` 提供压缩包和安装包的 SHA256 校验值。

## 引擎设计

| 模块 | 实现 |
| --- | --- |
| `gbm-file` | Windows seek_read / Unix read_at；8 MiB 扫描缓冲；UTF-8 和带 BOM 的 UTF-16 LE/BE；64 KiB 行片段上限 |
| `gbm-index` | 64 字节阅读区段记录，磁盘二分定位；16 字节标题位置记录；磁盘分页读取标题正文；redb 存储全局引用定义及标题锚点，重复编号也在磁盘维护 |
| `gbm-parser` | pulldown-cmark，GFM 表格、任务列表和删除线；原始 HTML 转义；安全链接和本地图片占位；源字节位置映射 |
| `gbm-render` | 有界 HTML 片段；普通 Markdown、围栏内代码和超大块兼容文本 |
| `gbm-search` | UTF-8 字面量使用 memmem 流式扫描；Unicode 小写匹配及 UTF-16 保留原始字节偏移；跨缓冲匹配和取消 |
| `gbm-core` | 多文档生命周期、按规范路径复用句柄；索引扫描排队及取消；每文档搜索隔离；全局共享 16 MiB 渲染 LRU；版本校验；图片目录约束和尺寸预算 |

前端不会接收完整源文件或全文 AST。阅读区采用最多 4 个有界区段的分段虚拟窗口，通过源位置锚点回收离屏内容；每次常规请求预算 64 KiB。目录和搜索结果使用 TanStack Virtual。目录每段最多 1,000 个标题，另有全局分页滑块，避免数百万标题产生超过浏览器限制的滚动高度。目录及搜索结果各缓存最多 8 页。

单文档模式仅挂载当前文件的正文 DOM，对比模式最多挂载四个独立的有界阅读窗口。隐藏标签保留会话状态并卸载正文；关闭标签停止对应文件的索引和搜索，释放缓存。后台最多一个索引扫描运行，等待中的文件仍可读取首屏，关闭等待任务无需等其他文件扫描完成。上述既有性能数据不代表四份 1 GiB 文档同时阅读的内存或速度，仍需在目标硬件上单独测量。

索引缓存以规范路径、文件长度、修改时间和首/中/尾内容指纹作为身份。读文件期间每约 8 MiB 验证源版本；前端每 600 ms 检测变化并提示重新加载。完整索引可复用，未完成或版本过期的索引重新生成。

搜索继续扫描并统计全部匹配，最多保存前 10,000 条定位结果。取消、更换关键词和关闭文档会停止旧任务；新搜索等待旧扫描退出，避免多个大文件扫描争用资源。

图片仅接受文档目录内规范路径下的 PNG/JPEG/WebP/GIF/BMP/AVIF，拒绝 SVG、远程地址和越界路径。单文件不超过 16 MiB，解码尺寸不超过 800 万像素，同时最多 2 个读取请求，全局图片内存预算 64 MiB。离开预加载区域时释放图片。

## 性能验证

2026-10-13，Windows 10 19045、Ryzen 7 5800H、约 14 GiB 系统内存。实际生成并扫描了 **1,073,741,824 字节**混合 Markdown，包含中文、Emoji、表格、代码、列表以及约 588 万个标题。

| 核心指标 | 实测 |
| --- | --- |
| 首个渲染窗口 | 9.6 ms |
| 首窗口源数据 | 32.1 KiB |
| 完整索引 | 10.8 秒 |
| 100 次随机跳转 P95 | 6.3 ms |
| UTF-8 区分大小写全文搜索 | 1.1 秒 |
| Rust 基准进程峰值工作集 | 19.1 MiB |

以上是暖文件系统缓存条件下的 **核心引擎**数据，首窗口不是完整桌面启动时间，内存不包括 WebView2。原始报告保存在 `benchmarks/results/1GiB-mixed-final.json`，首次未优化测量也保留供比较。100 MiB 连续围栏、巨型表格和单行超长文档分别有独立报告。不得据此宣称所有硬件上的 60 FPS 或完整应用小于 600 MiB。

`v0.1.0` 发布构建通过真实 WebView2 的 1 GiB 首屏、50% 跳转、搜索结果定位、目录同步、代码高亮和前后区段切换检查，无页面错误。测试后应用与 WebView2 子进程合计工作集单次采样约 **518 MiB**，包含共享页，不代表峰值或独占内存。详情见 `artifacts/desktop-checks.json` 和 `benchmarks/results/desktop-memory.json`。可使用 `./scripts/measure-desktop-memory.ps1 -ReaderPid <进程ID> -DocumentBytes <文件字节数>` 复测。

复现：

```powershell
node scripts/generate-fixture.mjs mixed 1024
cargo build --release -p gbm-core --example benchmark
./scripts/benchmark.ps1 -Path ./benchmarks/fixtures/mixed-1024MiB.md
```

生成器支持 `mixed`、`paragraphs`、`headings`、`code`、`table`、`longline`、`unicode`、`references`，大小参数为 MiB，最高 5120。`benchmarks/fixtures` 的大文件不进入版本控制。生成前检查可用磁盘空间。

## 兼容边界

本版本实现常见块的局部渲染及围栏恢复，常见语法通过全量/分页输出对比测试。超长行和超过单次预算的复杂块会保留原文、明确降级；巨型表格当前使用兼容文本，并未实现固定表头。目录标题最长显示 512 个字符。

跨区段全局引用目前识别顶层单行定义；复杂多行定义、嵌套容器、脚注和原始 HTML 的完整跨页语义仍需扩展。CommonMark 官方完整用例尚未全部验收。原始 HTML 故意转义，远程图片故意禁用。

2–5 GiB 扩展、8 GiB 内存机器、冷盘首屏、长时间滚动 FPS，以及干净 Windows 11 的安装/卸载与关联回归需要继续在对应环境测量。安装包未代码签名。完整离线包可以离线安装 WebView2，Microsoft Runtime 使用其自身许可证。

源码使用 MIT 许可证；依赖保留各自许可证。GitHub Actions 包含 Windows 格式、lint、核心测试、前端构建及 NSIS 产物流水线。

## 分支与发布

`main` 和 `dev` 在合并完成后保持一致；开发提交在独立分支上完成，先合入 `dev`，再合入 `main`。开始开发时先同步，再从 `dev` 创建独立分支：

```powershell
git fetch origin
git switch dev
git merge --ff-only origin/main
git switch -c feature/your-feature
```

开发分支合入 `dev`、`dev` 合入 `main` 时统一使用 `--no-ff`，保留分叉与合并轨迹。合并后将 `dev` 快进同步到 `main`，使两个分支指向同一提交：

```powershell
git switch dev
git merge --no-ff feature/your-feature
git switch main
git merge --no-ff dev
git switch dev
git merge --ff-only main
git push origin main dev
```

上述快进操作仅用于分支同步。`main` 推送后，`Sync Dev` 工作流也会自动将远程 `dev` 快进到 `main`。同步存在短暂延迟；若 `dev` 意外分叉，工作流报错，需先处理分叉，不强制覆盖提交。工作流需要 GitHub Actions 启用，且分支规则允许工作流推送 `dev`。

发布使用附注标签 `vX.Y.Z`。`v0.1.0` 固定指向首次发布提交 `92e4b7e`；标签不随后续分支更新移动。
