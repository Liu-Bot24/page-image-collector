# 图片采集查看器修复文档

**生成时间:** 2026-05-11  
**当前状态:** Phase 1 至 Phase 8 已完成初版修复。  
**适用基线:** `main` 分支当前代码，工作区在写本文档前为干净状态。  

---

## 0. 不可违反原则

这些原则优先级高于任何局部代码优化。后续每一期修复都必须先对照本节确认。

1. **优先保证产品功能实现。**  
   如果某个修复会导致原本能够抓取到的图片变得抓取不到，该修复不成立，必须回退或重做。

2. **必须考虑 Chrome 浏览器和扩展平台的现实约束。**  
   原项目的某些实现可能是在 Chrome MV3、权限、下载 API、跨域请求、Referer、防盗链、Service Worker 生命周期等限制下做出的绕行。修复前必须确认方案能在真实 Chrome 扩展产品中落地，不能只追求代码层面“更漂亮”。

3. **先文档，后代码。**  
   待修复内容、执行边界、验收方式必须先写入本文档并向用户汇报。未经确认，不直接进入代码修改。

4. **README 相关调整必须先过用户确认。**  
   所有涉及 README 的文案收窄、能力说明、限制说明、安装说明、功能口径调整，都必须在最终版本前单独列出变更点并交给用户确认。未经确认，不直接修改 README。

5. **README 项目结构不作为缺陷。**  
   README 中保留项目结构说明是用户明确允许的内容，不再作为待修复项提出。

6. **漫画分页的用户确认不是缺陷。**  
   “检测到分页后由用户点击加载”是合理的安全边界。本文档不把“没有自动一路抓完后续分页”列为问题。

---

## 1. 复核结论

这次没有重新拉起六个子代理从零审计，但在写本文档前重新复核了 README、隐私文档、manifest 和五个核心脚本中的关键路径。上一轮审计的大方向仍成立：

- 项目具备真实核心能力，不是空壳：能扫描常见图片来源，展示、筛选、选择、复制、逐张下载、ZIP 打包，并提供漫画模式与分页加载入口。
- 高风险点集中在长任务下载/ZIP、扩展页面 DOM 注入面、状态归并一致性、自动采集覆盖、漫画分页顺序和懒加载边界。
- 后续修复必须以“不削弱抓取能力”为硬约束，不能通过收窄来源、删掉兼容绕行、降低跨站图片处理能力来换取表面安全。

参考的平台约束：

- Chrome 官方 MV3 Service Worker 生命周期文档说明，扩展 Service Worker 可能在空闲后终止，单个事件或 API 请求处理过长也会被终止。  
  来源: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome 官方 offscreen document 文档列出 `BLOBS` 作为 offscreen document 的使用理由，适用于需要处理 Blob / `URL.createObjectURL()` 的扩展场景。  
  来源: https://developer.chrome.com/docs/extensions/reference/offscreen
- MDN 明确说明 `URL.createObjectURL()` 不可用于 Service Worker。  
  来源: https://developer.mozilla.org/docs/Web/API/URL/createObjectURL_static

---

## 2. 当前真实能力边界

### 已经具备的能力

- 支持 `img`、`picture`、`srcset`、常见懒加载属性、背景图等多来源扫描。
- 支持手动扫描、继续扫描、自动采集、自动滚动。
- 支持 Popup 与 Workspace 两套界面共享同一标签页结果。
- 支持选择、批量复制链接、逐张批量下载、ZIP 打包和分卷输出。
- 支持部分站点的原图候选、WebP/JPG 回退、防盗链 Referer 规则。
- 支持漫画模式按当前页面 DOM 顺序组织图片，并检测分页入口，用户确认后加载后续页。

### 不能过度承诺的边界

- 大批量 ZIP 目前不能证明在 MV3 Service Worker 长任务下稳定。
- 后续分页页如果依赖滚动触发懒加载，目前不保证完整采集。
- 跨页漫画顺序目前缺少稳定的 page/order 元数据，不能严格保证全站阅读顺序。
- 自动采集覆盖面小于手动扫描覆盖面。
- 对有强防盗链、登录态、动态 canvas/blob、虚拟列表的网站，只能尽力采集可访问资源，不能承诺全量。

---

## 3. 修复总览

| 阶段 | 优先级 | 主题 | 状态 |
| --- | --- | --- | --- |
| Phase 1 | P1 | MV3 长任务与 ZIP/下载可靠性 | 已完成初版修复 |
| Phase 2 | P1 | 权限、DNR 与 Referer 安全合规边界 | 已完成初版修复 |
| Phase 3 | P1 | 扩展页面 DOM 注入面与 URL 安全 | 已完成初版修复 |
| Phase 4 | P1 | 状态归并、HD 回退和索引一致性 | 已完成初版修复 |
| Phase 5 | P1/P2 | 自动采集覆盖与手动扫描能力对齐 | 已完成初版修复 |
| Phase 6 | P2 | 漫画分页顺序、隐藏页懒加载与滚动边界 | 已完成初版修复 |
| Phase 7 | P2 | Workspace/Popup 大量图片性能与状态一致性 | 已完成初版修复 |
| Phase 8 | P2/P3 | 隐私披露、README 口径、测试体系、发布验证 | 已完成初版修复 |

---

## 4. Phase 1: MV3 长任务与 ZIP/下载可靠性

**目标:** 让大批量 ZIP 打包和下载在真实 Chrome MV3 扩展环境下更稳定，同时不削弱任何图片获取能力。

**问题证据:**

- `background/background.js` 中 `DOWNLOAD_BATCH` 在 ZIP 模式下直接 `await downloadBatchAsZip(...)`，整个 ZIP 流程运行在一次后台消息处理内。
- `downloadBatchAsZip` 串行执行图片抓取、可选格式转换、ZIP entry 生成、分卷、Blob 下载。
- `downloadBlobAsFile` 优先尝试 `URL.createObjectURL(blob)`，不可用时退回 data URL。Service Worker 环境下 `createObjectURL` 不可用，超大 data URL 不是可靠的大文件下载通道。
- `buildZipEntryFromImage` 只检查字节非空，可能把 HTTP 200 的 HTML 错误页或非图片响应作为图片 entry 打进 ZIP。

**必须保留的现有能力:**

- 不能减少当前下载候选顺序：HD、src、originalSrc、WebP/JPG 回退仍要保留。
- 不能移除现有防盗链绕行能力，例如必要的 Referer 处理。
- 不能取消分卷能力；大批量任务仍应自动分卷。
- 不能把 ZIP 修复变成只支持少量图片的小功能。
- 不能影响非 ZIP 的逐张批量下载路径。

**Chrome 平台约束:**

- 不能把长时间 ZIP 打包继续绑定在一个 Service Worker message handler 上。
- 不能依赖 Service Worker 中的 `URL.createObjectURL()`。
- offscreen document 可作为 Blob/Object URL 相关工作的候选落点，但 offscreen document 只能使用有限扩展 API，必须通过 `chrome.runtime` 消息和后台协作。
- `chrome.downloads.download` 仍应由有 downloads 权限的扩展上下文调度，且需要可靠处理完成、失败、0B 文件、取消等状态。

**修复方向:**

- 将 ZIP 打包拆成后台调度 + 可持续执行上下文打包 + 后台下载确认三个环节。
- 优先评估 offscreen document 承担 Blob/Object URL 与 ZIP 分卷生成。
- 后台不等待整个 ZIP 任务完成后才响应 UI，而是启动任务后立即返回 accepted 状态，并通过进度消息更新 Popup/Workspace。
- 增加响应载荷校验：HTTP 状态、MIME、URL 推断、图片头部探测至少满足一组可信条件后再写入 ZIP。
- 分卷下载必须逐卷确认成功，失败时保留已完成卷信息并报告失败卷。

**验收标准:**

- ZIP 任务启动后 Popup 关闭再打开，仍能看到任务状态或最终结果。
- 大批量任务不会因为一个长 `DOWNLOAD_BATCH` 响应挂起而让 UI 误以为失败。
- 在 Service Worker 不支持 `URL.createObjectURL()` 的前提下仍能下载 ZIP。
- HTML 错误页不会被当作成功图片打包。
- 逐张批量下载不回退、不删功能、不改变原有候选 URL 覆盖面。

**执行状态（2026-05-11）:**

- 已新增 offscreen document 作为 ZIP 打包与 Blob URL 创建上下文。
- ZIP 模式下 `DOWNLOAD_BATCH` 改为启动异步任务并立即返回 accepted，Popup/Workspace 继续通过 `DOWNLOAD_PROGRESS` 和 `GET_DOWNLOAD_STATUS` 更新状态。
- 后台仍负责 `chrome.downloads.download`、下载完成/中断监听、非 0B 校验和状态转发。
- 已新增 ZIP entry 载荷校验，避免 HTML 响应被当作图片打包。
- 已修复小 ZIP 下载终态早于 offscreen 等待器/后台 pending 记录导致任务卡住的竞态。
- 已为 offscreen 分卷下载等待增加超时失败收敛，并清理对应 pending 记录，避免永久占用任务状态。
- 已将 ZIP 分卷策略做成 Workspace 的持久化全局下载偏好，默认保持 `192MB / 300 张`，并提供更稳/更大分卷 preset；Popup 不放入口，下载时由后台读取该全局偏好。
- 非 ZIP 逐张批量下载路径未改。
- 已通过 Node 测试、脚本语法检查、manifest 解析和真实 Chromium 扩展 ZIP 冒烟测试；分卷 preset 已用 305 张小图验证“大包”配置会保持单卷。
- 残余风险：当前仍不是 streaming ZIP；单卷内存压力受分卷阈值和用户 preset 控制但未彻底消除。Service Worker 重启后的任务状态已做持久化补强，但极端情况下 offscreen 文档被浏览器关闭时仍会以失败状态收敛。

---

## 5. Phase 2: 权限、DNR 与 Referer 安全合规边界

**目标:** 在不削弱跨站图片抓取、防盗链兼容和已支持站点能力的前提下，收敛权限与请求头改写的作用范围，降低串页、来源泄露和 Chrome Web Store 审核风险。

**问题证据:**

- `manifest.json` 申请 `<all_urls>` host permissions，并在 `<all_urls>` 上注入 content script。
- `background/background.js` 存在固定的全局 sinaimg Referer DNR 规则。
- `background/background.js` 还会按图片 host 添加动态 Referer 规则，规则按 host 全局生效，缺少 tab、initiator 或任务生命周期隔离。
- 这些能力有现实产品原因：跨站图片扫描、下载、防盗链绕行都可能依赖它们。但当前作用域偏宽，解释成本和副作用风险偏高。

**必须保留的现有能力:**

- 不能直接移除 `<all_urls>` 导致任意网页采图能力退化。
- 不能直接移除 content script 全站匹配导致用户需要逐站授权后才能使用基础能力。
- 不能粗暴删除 Referer 绕行，导致微博图床、外部图床、防盗链站点原本能下载的图片失败。
- 不能把 DNR 收窄到只支持少数硬编码站点。

**Chrome 平台约束:**

- MV3 下请求头修改应通过 `declarativeNetRequest` 等允许的扩展机制完成，不能回退到 MV2 风格阻塞式 webRequest 方案。
- 动态规则数量有限，规则生命周期需要可清理、可恢复、可解释。
- host permissions 与 content script 匹配范围是 Chrome Web Store 审核重点，保留 broad permission 时必须有真实功能理由。

**修复方向:**

- 先梳理哪些功能实际依赖 `<all_urls>`、全站 content script、DNR Referer 规则，并写出保留理由。
- 将动态 Referer 规则尽量绑定到任务窗口、source origin、tab 相关上下文或可清理生命周期，不让一次页面采集长期影响其他页面。
- 对全局 sinaimg 规则做单独评估：若保留，说明它服务于已知高频图床兼容；若可改成按需规则，则纳入按需生命周期。
- 增加规则清理和状态恢复验证，避免陈旧规则残留。

**验收标准:**

- 原本能通过 Referer 绕行下载的典型图片仍能下载。
- 动态 Referer 规则不会无限残留，也不会无差别影响无关页面。
- 权限说明能解释为什么保留或调整 `<all_urls>`。
- 不引入 Chrome 平台不支持的请求拦截方案。

**执行状态（2026-05-11）:**

- 保留 `<all_urls>` 与全站 content script，不在本阶段削弱任意网页采图能力；该权限仍服务于基础扫描、自动采集、右键菜单和跨站图片识别。
- 固定 sinaimg Referer 兼容规则从持久 dynamic rule 改为 session rule，并在启动时清理旧版遗留 dynamic rule；因它服务于微博高频图床及直接打开原图场景，仍保留 `main_frame` 兼容范围。
- 普通跨域图片 Referer 规则改为 session rule，使用 `requestDomains` 限定目标图片域名，不再使用宽泛 `urlFilter`；普通图片规则不包含 `main_frame`。
- 普通图片 Referer 规则增加 30 分钟 TTL、来源 tab 关联、tab 关闭/刷新清理，并保存轻量 metadata 以支持 service worker 重启后的清理/续用。
- 已新增 `shared/dnrCore.js` 和 Node 测试，覆盖 DNR hostname、Referer origin 与规则构造边界。
- 已通过真实 Chromium 扩展 DNR 冒烟测试：本地 `page.test` 页面扫描 `img.test` 图片后生成 session rule，刷新页面后该图片规则被清理，且没有遗留 dynamic Referer rule。
- 残余边界：由于扩展页/offscreen 发起的图片请求并不总能可靠绑定回源网页 tab，普通图片 Referer 规则仍按图片域名生效于扩展请求窗口；当前通过 session rule、TTL 和 tab 生命周期清理降低串页与长期残留风险，而不是承诺做到每个 fetch 请求级别的精确隔离。

---

## 6. Phase 3: 扩展页面 DOM 注入面与 URL 安全

**目标:** 消除 Popup/Workspace 中由页面来源数据进入 `innerHTML` 的注入风险，同时不影响图片预览、格式展示和交互。

**问题证据:**

- `popup/popup.js` 的图片卡片使用 `card.innerHTML` 拼接 `displaySrc`、格式、尺寸等字段。
- `workspace/workspace.js` 的图片卡片同样使用 `card.innerHTML` 拼接页面来源字段。
- 图片 URL、格式参数等来自网页，属于不可信输入。

**必须保留的现有能力:**

- 不能因为安全处理而拒绝正常 `http:`、`https:`、可合法展示的扩展/Blob/data 图片来源。
- 不能破坏 HD 标识、格式筛选、选中、灯箱、全屏预览、错误回退。
- 不能影响已有图片卡片布局。

**修复方向:**

- 将图片卡片改成 DOM API 创建节点，文本使用 `textContent`，图片地址使用受控属性赋值。
- 对用于预览的 URL 做协议允许列表和最小化处理；不把页面字符串直接注入 HTML。
- 保留现有 fallbackImageError、openLightbox、checkbox 事件绑定。

**验收标准:**

- 恶意 URL 或格式字符串不能在 Popup/Workspace 中插入额外标签或事件处理器。
- 正常图片仍可预览、选择、下载、复制。
- 所有原有卡片交互路径仍工作。

**执行状态（2026-05-11）:**

- Popup 图片卡片从 `card.innerHTML` 改为 DOM API 构建；图片 URL 通过属性赋值和协议允许列表处理，格式、尺寸、面积、HD 标识、选中按钮均使用 `textContent` 或受控属性。
- Workspace 图片卡片同样改为 DOM API 构建，保留 HD 标识、格式角标、尺寸/面积、选中按钮、灯箱打开、错误回退和尺寸探测。
- Popup/Workspace 的格式筛选项从模板字符串改为 DOM API，避免把统计字段或标签文本拼进 HTML。
- 保留容器清空用的 `innerHTML = ""`，这类用法不接收页面数据，不属于注入入口。
- 已增加预览 URL 协议允许列表：`http:`、`https:`、`blob:`、`data:image/*`、同源 `chrome-extension:`；非法 URL 不写入 `img.src`。
- 已通过真实 Chromium 扩展 DOM 安全烟测：向后台注入带恶意 `format` 和异常 URL 字符的图片记录，Workspace 渲染后没有额外标签或事件处理器执行，卡片选择仍可用。

---

## 7. Phase 4: 状态归并、HD 回退和索引一致性

**目标:** 避免同一图片因发现顺序或高清 URL 差异重复入库，并保留用户对 HD 回退的选择。

**问题证据:**

- `background/stateManager.js` 用 `imagesByNormalized` 和 `imagesByHdSrc` 合并图片，但 `imagesByHdSrc` 只按原始 `hdSrc` 建索引。
- 如果先发现全尺寸 URL，后发现缩略图并把全尺寸 URL 放在 `hdSrc`，当前逻辑可能无法合并。
- 如果后续扫描替换记录，`hdRejected` 可能被新记录覆盖。
- `clearTabImages` 清空 `images`、`imagesByNormalized`、`selectedIds`，但未清空 `imagesByHdSrc`。

**必须保留的现有能力:**

- 不能降低 Telegram blob、XHS、微博等当前特殊归并兼容。
- 不能把宽松归并做得过度，导致不同图片被误合并。
- 不能丢失用户选中状态之外的必要图片元数据。

**修复方向:**

- 为 `hdSrc` 同时建立原始 URL 与归一化 URL 索引。
- 查重时双向检查：incoming normalized 是否命中已有 HD 索引，incoming HD 是否命中已有 normalized。
- 替换记录时保留 `hdRejected`，并重新计算 `isHD`。
- 清空标签页时同步清空全部索引。

**验收标准:**

- 缩略图先出现和全尺寸图先出现都只保留一条逻辑记录。
- 用户因 HD 下载失败产生的回退状态不会被后续扫描冲掉。
- 清空后不会因陈旧 HD 索引影响下一轮采集。

**执行状态（2026-05-11）:**

- `stateManager` 新增统一图片索引函数，同时索引 `normalized`、`hdSrc`、`originalSrc` 及其归一化 URL。
- 查重改为双向检查：incoming normalized、incoming HD/original 候选都能命中已有 normalized/HD 索引；全尺寸先出现、缩略图后出现时不再重复入库。
- 替换记录时保留已有 `hdRejected`，并基于保留后的状态重算 `isHD`，避免用户 HD 回退状态被后续扫描覆盖。
- `clearTabImages` 已同步清空 `imagesByHdSrc`，避免陈旧 HD 索引进入下一轮采集。
- 已新增 `test/stateManager.test.mjs`，覆盖“全尺寸先出现再出现缩略图”和“HD 回退状态保留”两个回归场景。

---

## 8. Phase 5: 自动采集覆盖与手动扫描能力对齐

**目标:** 自动采集尽量继承手动扫描的图片来源覆盖，不通过收窄来源来规避复杂性。

**问题证据:**

- 手动扫描读取 `data-original`、`data-original-src`、`data-lazy-src`、`data-actualsrc`、`data-zoom-image`、`data-large-image`、`data-url`、`data-pic`、`data-srcset`、`srcset` 等字段。
- 自动采集 MutationObserver 的 `attributeFilter` 目前只监听 `src`、`srcset`、`style`、`data-src`、`data-srcset`。
- `parseSrcset` 使用简单逗号切分，对复杂 URL 场景不够稳。

**必须保留的现有能力:**

- 手动扫描已支持的懒加载字段不能减少。
- 自动采集不能因为监听更多字段而造成明显性能灾难；需要去抖和根节点最小化扫描。
- 不能对特定站点写大量脆弱特判替代通用策略。

**修复方向:**

- 扩展自动采集监听字段，使其覆盖手动扫描中已支持的关键懒加载属性。
- 对 mutation root 做去重和批处理，避免每个属性变化触发全量扫描。
- 改进 `srcset` 解析，优先使用浏览器可接受的解析策略或更稳健的候选拆分。

**验收标准:**

- 只通过 `data-original` 或 `data-lazy-src` 后置填充的图片，自动采集也能发现。
- 自动采集不会在普通动态页面中造成明显卡顿。
- 手动扫描结果不回退。

**执行状态（2026-05-11）:**

- 自动采集 `MutationObserver` 的监听字段已补齐到手动扫描支持的关键懒加载属性，包括 `data-original`、`data-original-src`、`data-lazy-src`、`data-actualsrc`、`data-zoom-image`、`data-large-image`、`data-url`、`data-pic` 等。
- 保留原有去抖、mutation root 去重和局部根扫描策略，监听字段扩展后不改成每次属性变化全量重扫。
- `srcset` 候选拆分已从简单逗号切分改为更稳健的候选拆分，避免普通 URL 与 data URL 场景被明显误切。
- 已通过 Chromium 真实扩展冒烟：开启自动采集后，页面动态写入 `data-original` 与 `data-lazy-src`，后台均能收到新增图片。
- 手动扫描字段覆盖未收窄。

---

## 9. Phase 6: 漫画分页顺序、隐藏页懒加载与滚动边界

**目标:** 保持用户确认加载分页的安全交互，同时提升跨页采集完整性和顺序可信度。

**问题证据:**

- `content/content.js` 的漫画序列来自当前页面 DOM 顺序。
- 后续分页由后台打开隐藏标签页扫描后合并回源标签页状态，但状态记录缺少 page index/order 元数据。
- README 已提示后续页若依赖滚动触发懒加载，未进入视口的图片可能不会被采集；代码中隐藏页加载后主要执行一次扫描。
- 自动滚动当前主要围绕文档滚动元素和 `window.scrollTo`，对内层滚动容器支持不足。

**必须保留的现有能力:**

- 不能改成进入漫画模式后自动无限抓取后续分页。
- 用户必须有确认、停止、容错空间。
- 当前 DOM 顺序阅读能力不能退化。
- 后续页加载失败不能污染已采集结果。

**修复方向:**

- 为分页加载结果增加 page index 和 within-page order 元数据，用于 Workspace 漫画排序。
- 对隐藏页增加有边界的滚动/等待策略，并限制页数、时间和失败反馈。
- 检测常见内层滚动容器，必要时在用户触发的自动滚动中支持容器滚动。

**验收标准:**

- 多页漫画按页序和页内顺序稳定展示。
- 依赖基础懒加载的后续页采集率提升。
- 不出现无确认的长时间跨页抓取。

**执行状态（2026-05-11）:**

- 后续分页隐藏页扫描结果已增加 `comicPageIndex`、`comicPageOrder`、`comicPageUrl` 元数据，用于保留页序和页内 DOM 顺序。
- Workspace 漫画模式排序已消费分页顺序元数据：当前页仍优先使用原网页 DOM 序列，后续分页图片按页序和页内顺序排列，其余未匹配图片保持原有相对顺序。
- 后续分页加载仍必须由用户点击触发，保留页数上限和每页等待上限；没有改成进入漫画模式后自动无限抓取。
- 隐藏页扫描前增加有边界的自动采集与漫画滚动等待，用用户设置的每页最长等待时间约束懒加载补偿。
- 已通过 Node 测试和 Chromium 真实扩展冒烟：第 2 页图片只有滚动后才写入 `data-original`，分页加载后仍能抓到该图片并带有页序元数据；Workspace 漫画模式展示为第 1 页在前、第 2 页在后。

---

## 10. Phase 7: Workspace/Popup 大量图片性能与状态一致性

**目标:** 让大批量图片筛选和处理保持可用，避免 UI 因全量 DOM 重建明显卡顿。

**问题证据:**

- Popup 和 Workspace 渲染列表时存在清空容器再重建全部卡片的路径。
- Workspace 图片量大时，筛选、隐藏、选中可能触发大量 DOM 操作。
- 隐藏图片状态主要存在 Workspace 内存中，Popup 与 Workspace 行为可能不一致。

**必须保留的现有能力:**

- 不能因为性能优化降低筛选维度、隐藏能力、选中能力。
- 不能改变用户已习惯的 Popup 快速操作与 Workspace 批量操作分工。

**修复方向:**

- Workspace 优先做虚拟列表或分批渲染。
- Popup 保持轻量，但避免不必要的全量重建。
- 明确隐藏状态是会话级还是持久级；若产品上应共享，则纳入后台状态。
- 若隐藏/显示最终仍设计为 Workspace 会话级能力，README 对该能力的说明必须收窄，并在修改前先提交给用户确认。

**验收标准:**

- 大量图片下滚动、筛选、选择不会明显阻塞。
- Popup/Workspace 对隐藏状态没有无法解释的不一致。

**执行状态（2026-05-11）:**

- 隐藏图片状态已从 Workspace 内存态迁移到后台 tab state：隐藏/显示记录会随当前标签页采集状态一起保存，刷新 Workspace 后仍可恢复。
- `GET_IMAGES` 返回的图片记录带 `hidden` 标记；Workspace 默认不显示隐藏图片，选择“隐藏”筛选时只看隐藏图片；Popup 默认过滤掉隐藏图片，避免同一批结果在两个入口中出现明显不一致。
- 隐藏/显示操作通过后台 `SET_HIDDEN_IMAGES` 更新状态，并自动取消被操作图片的选中状态，避免隐藏后仍被批量下载或复制。
- Workspace 图片卡片渲染改为分批追加，每批 80 张，中间让出一帧，降低一次性创建大量 DOM 卡片造成的长时间卡顿。
- 已通过 Node 测试和 Chromium 真实扩展冒烟：130 张图片完整渲染；隐藏 1 张后刷新 Workspace 默认显示 129 张，切到“隐藏”筛选能看到被隐藏图片。

---

## 11. Phase 8: 隐私披露、README 口径、测试体系、发布验证

**目标:** 让产品说明、隐私披露和回归验证跟上功能复杂度。

**问题证据:**

- `PRIVACY.md` 说明了本地处理、复制、下载、ZIP，但没有足够明确地披露为提取支持站点内容而进行的带凭据源页面请求。
- 仓库当前没有 `package.json`、自动化测试入口、CI 或最小发布检查脚本。
- 核心文件体量较大，未来修复容易引入回归。
- README 中若有能力口径需要随着修复结果收窄或澄清，必须在最终版本前单独给用户确认；README 项目结构仍不作为缺陷。

**必须保留的现有能力:**

- 隐私说明不能夸大收集范围，也不能隐瞒真实网络行为。
- 测试体系不能要求用户安装复杂工具后才能使用扩展。
- 重构不能和高风险行为修复混在一起，避免难以回滚。
- README 调整不能擅自删除用户明确允许的项目结构说明。

**修复方向:**

- 更新隐私文档，准确描述扩展在用户当前页面、用户操作下载/复制、支持平台提取时的本地和网络行为。
- 如需调整 README，只调整真实功能口径、限制说明或使用说明；每一处 README 改动必须先形成待确认清单，用户确认后再落盘。
- 增加最小 Node 测试入口，先覆盖纯逻辑：状态归并、URL 归一化、ZIP 响应校验、srcset 解析。
- 增加发布检查文档：语法检查、manifest 解析、加载未打包扩展、关键页面冒烟测试。

**验收标准:**

- 另一个维护者能按文档跑完最小验证。
- 隐私描述和代码实际行为一致。
- README 相关调整已经过用户确认。
- 后续每期修复至少有对应的自动化或浏览器冒烟验证。

**执行状态（2026-05-11）:**

- `PRIVACY.md` 已补充真实网络行为说明：当前页图片资源请求、用户触发下载/ZIP 请求、必要的来源信息处理，以及支持站点深度解析时可能使用浏览器已有登录态请求来源页面 HTML。
- 已新增最小 Node 测试入口和 `package.json`，当前覆盖 ZIP 响应校验、ZIP 分卷配置、DNR 规则构造、状态归并、隐藏状态和漫画分页顺序标注等纯逻辑。
- 已新增 `docs/release-checklist.md`，记录语法检查、manifest 解析、Chrome 未打包加载和核心功能冒烟流程。
- 已新增 `docs/readme-change-proposal.md`，只列 README 待确认调整清单，不直接修改 README。
- 用户已确认 `docs/readme-change-proposal.md` 清单；`README.md` 和 `README-en.md` 已按清单补充 ZIP 分卷入口、自动采集边界、漫画分页确认加载、隐藏图片行为和限制说明，未调整项目结构说明。

---

## 12. 分期执行规则

每一期开始前必须先汇报：

- 本期只修哪些问题。
- 本期明确不碰哪些路径，尤其是不碰会影响图片来源覆盖的路径。
- 本期涉及的 Chrome 平台约束是什么。
- 本期用什么验证证明没有破坏既有能力。
- 本期是否涉及 README；如果涉及，必须先列出待改点并等待用户确认。

每一期完成后必须汇报：

- 修改了哪些文件。
- 解决了哪个文档条目。
- 跑了哪些验证，结果如何。
- 剩余风险是什么。

如果实现过程中发现某个修复方向会削弱抓图能力，或不符合 Chrome 扩展平台规则，必须停止并回到文档更新，不继续硬改。
