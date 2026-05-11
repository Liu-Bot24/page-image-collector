# 发布检查清单

适用于未打包 Chrome 扩展测试、正式打包前检查和修复分支回归验证。

## 1. 静态检查

```bash
npm run build:vendor
npm test
node --check background/background.js
node --check background/stateManager.js
node --check content/content.js
node --check offscreen/offscreen.js
node --check popup/popup.js
node --check workspace/workspace.js
node --check shared/zipCore.js
node --check shared/dnrCore.js
node --check shared/comicCore.js
node --check vendor/content-parsers.js
node --check vendor/workspace-virtual.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest-ok')"
```

## 2. Chrome 加载检查

1. 打开 `chrome://extensions/`。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择项目根目录。
5. 确认扩展无 manifest、权限、service worker 或 offscreen document 加载错误。
6. 确认未出现 `Could not load javascript 'vendor/content-parsers.js'`、`Could not load javascript 'vendor/workspace-virtual.js'` 或扩展页 CSP 错误。

## 3. 核心功能冒烟

- 普通页面扫描：确认 `img`、`picture/srcset`、常见懒加载属性和背景图能进入结果列表。
- Popup：确认开始扫描、筛选、选择、批量复制、批量下载入口可用，布局无横向溢出。
- Workspace：确认筛选、选择、隐藏/显示、灯箱、全屏看图、打开下载目录可用。
- Workspace 虚拟网格：600+ 图片、网格模式下确认 DOM 卡片数量接近可视范围加预渲染缓冲，而不是等于总图片数。
- Workspace 虚拟网格：确认选择、隐藏/显示、格式筛选、分辨率筛选、灯箱、全屏和键盘切换仍然对应正确图片。
- Workspace 虚拟网格：确认首屏和向下滚动后框选都能选中当前可见图片。
- Workspace 虚拟网格：确认大到小排序后的卡片顺序和灯箱上一张/下一张顺序一致。
- Workspace 瀑布流：确认仍使用原完整渲染布局，不出现虚拟网格样式残留。
- ZIP：确认默认分卷配置可正常打包下载；大包配置只从 Workspace 设置入口调整。
- 自动采集：确认页面滚动后动态写入 `data-original` 或 `data-lazy-src` 的图片能自动进入列表。
- 漫画模式：确认当前页按阅读顺序显示；后续分页需要用户点击后才加载。
- 后续分页：确认每页等待上限生效，加载失败不会清空已采集图片。

## 4. 回归重点

- 不能因为安全处理而减少正常 `http:` / `https:` 图片采集。
- 不能把 HTML 错误页打入 ZIP 当作图片。
- 不能让隐藏图片继续参与批量复制或批量下载。
- 不能让 Popup 出现 ZIP 分卷设置入口。
- README 如需调整，必须先按 `docs/readme-change-proposal.md` 的清单确认后再修改。
