# 审计修复与验证

修复基于远端 `main` 的 `616fc7ef2d9c32cd277afa148503a97a530df8fc`（v1.2.8）。保留现有 Manifest V3、采集方式和界面框架。

| 场景 | 修复后的行为 | 自动验证 |
| --- | --- | --- |
| 缩略图和高清图尺寸不同 | 宽、高、面积、URL、格式共同选择；旧的不一致尺寸可重新校正 | `imageMetadataUi`、`stateManager` |
| 下载已创建但尚未完成 | 批量统计等待浏览器终态；网络失败可以回退，用户取消不重下该图片 | `backgroundDownloads`、`directDownloadJobs` |
| 下载期间后台重启 | 保存任务和 downloadId；恢复查询原下载，避免重复入队 | `directDownloadJobs` |
| 两个来源共享图床 | 界面规则限定实际请求标签页和本扩展；后台请求按来源调度，冲突来源不会覆盖在途规则 | `backgroundReferer`、`refererRequests`、浏览器烟测 |
| 图片 URL 升级后保存和恢复 | 图片 ID、选中、隐藏状态保持稳定；共享占位图不会合并不同图片 | `stateManager`、`imageIdentityIntegration` |
| 推测大图失效 | 保留浏览器实际加载地址和候选列表，普通下载和 ZIP 都可回退 | `contentAudit`、浏览器烟测 |
| 后续扫描只有推测信息 | 实际验证的高清地址和格式优先，不被新扫描降级 | `stateManager`、`imageMetadataUi` |
| 开启自动采集与同 URL 更新 | 初始结果成功提交后记账；有意义的元数据更新可再次上传，失败可重试 | `contentAudit`、浏览器烟测 |
| Telegram Blob 去重 | 依赖媒体身份，不根据相似尺寸删除不同图片 | `contentAudit`、`stateManager` |
| 探测失败或清空后请求返回 | 暂时失败可重试；过期任务不污染新列表与缓存 | `imageMetadataUi` |
| 非活动页自动滚动 | 定时器与动画帧共同推进，支持取消和截止时间 | `contentAudit`、浏览器烟测 |
| 存储读取或保存失败 | 读取失败不开放覆盖写入；保存失败保留待保存数据并在界面提示，可重试 | `stateManager`、`imageMetadataUi` |

## 性能改动

- Popup、Workspace 的尺寸探测统一进入队列。后台还限制跨界面的探测总并发为 8，只有 URL 和来源一致的在途请求才合并。
- 列表先显示已有元数据，再逐步补齐尺寸；选择一张图片仅更新相关卡片和统计。
- 增量扫描合并重叠子树，并监听图片加载、CSS 类变化和已发现的开放 Shadow Root。
- 浏览图片不再提前生成剪贴板 PNG；剪贴板缓存上限 16 MiB。
- 全屏预加载使用可取消的 Image 请求，离开预加载窗口即取消，保留缓存按解码像素估算限制为 64 MiB。
- Referer 规则集中比较差异，来源未变化时不重复安装或保存规则。

这些改动有并发、缓存容量和局部更新回归保护；没有宣称未经测量的总体提速比例或实际浏览器内存下降比例。

## 运行验证

首轮修复（`6b88d05`）验证为 181 项 Node 测试及 12 组完整扩展烟测通过，但后续审计仍复现了下载存储、Referer 容量、预览回退和跨窗口失效四组问题。测试数量不代表这些路径已经完整闭合；后续修复及逐项验收证据见 [审计补充修复](audit-followup.md)。

在项目根目录用 PowerShell 7 执行：

```powershell
npm ci
npm test
node scripts/browser-smoke.mjs
node scripts/browser-audit-followup.mjs
```

`npm test` 会先构建 vendor 文件，再运行 Node 回归测试。浏览器烟测使用已安装的 Playwright 和 Chromium，创建独立配置、本地 HTTP 测试页面和下载目录；不自动下载浏览器。若 Playwright 未安装在项目内，可设置 `PIC_PLAYWRIGHT_MODULE` 为已有运行时的入口，或设置 `PIC_CHROMIUM_EXECUTABLE` 指定浏览器路径。运行结果保存在已忽略的 `output/playwright/`，包含请求来源记录、下载终态与验证报告。

真实浏览器验证覆盖两个工作台、原生 Popup、后台尺寸探测、ZIP 图片字节、失败候选回退、下载完成状态、1080p 正反筛选、选择操作保留卡片节点，以及真实等待约 30 秒后的失败探测重试。测试服务器的 403、503 响应是预设失败场景。

## 验证边界

- 本机 Chromium 145 的测试页虽然 `tab.active=false`，但 `document.hidden` 仍为 false，RAF 也会运行。因此，真实非活动页多步滚动和取消已验证，RAF 完全暂停的条件由确定性回归模拟验证；浏览器彻底冻结页面时，定时器同样不能保证执行。
- Chrome 已创建下载但尚未来得及保存 downloadId 的极窄重启窗口会明确报告结果未知，要求查看浏览器下载记录，不冒险重复下载。
- 同一个工作台若出现相同 URL、不同来源的歧义候选，界面不会给该 URL 任意写入一个来源；明确携带来源的后台下载和探测仍由调度器隔离。
- 存储仍采用快照，没有迁移为按记录分片或 IndexedDB；大量图片仍可能达到 `storage.local` 配额，界面会报告保存失败。
- ZIP 的单文件大小、解码像素数和多个任务的总内存预算尚未重新设计；现有分卷配置不等同于实际内存上限。iframe 全覆盖、关闭的 Shadow Root 也未新增支持。

下载和规则行为依据 [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads) 与 [Declarative Net Request API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest) 实现。
