<div align="center">

# Page Image Collector

![Stars](https://img.shields.io/github/stars/Liu-Bot24/page-image-collector?style=flat&label=Stars&cache=20260704) ![Forks](https://img.shields.io/github/forks/Liu-Bot24/page-image-collector?style=flat&label=Forks&cache=20260704) ![Views 14d](https://github-stats.liu-qi.cn/api/badge/Liu-Bot24/page-image-collector/views14d.svg?v=4) ![Clones 14d](https://github-stats.liu-qi.cn/api/badge/Liu-Bot24/page-image-collector/clones14d.svg?v=4) ![Downloads](https://img.shields.io/github/downloads/Liu-Bot24/page-image-collector/total?style=flat&label=Downloads&cache=20260704) ![Release](https://img.shields.io/github/v/release/Liu-Bot24/page-image-collector?style=flat&label=Release&cache=20260704)

![Page Image Collector preview](assets/github-preview.jpg)

Languages: [简体中文](README.md) · [English](README-en.md)

</div>

A Chrome extension for daily browsing scenarios, used to quickly collect web page images, providing capabilities for filtering, viewing, batch copying, batch downloading, and ZIP archiving.

## Installation

### Install from Chrome Web Store (Recommended)

[Page Image Collector - Chrome Web Store](https://chromewebstore.google.com/detail/%E5%9B%BE%E7%89%87%E9%87%87%E9%9B%86%E6%9F%A5%E7%9C%8B%E5%99%A8/jchjkamalmegomjijigapilnecdccbom)

### Install from GitHub Releases

1. Go to the project's `Releases` page.
2. Download the unpacked zip for the corresponding version, e.g., `page-image-collector-1.2.8-unpacked.zip`.
3. Open `chrome://extensions/`.
4. Enable "Developer mode".
5. Unzip the downloaded ZIP file.
6. Click "Load unpacked".
7. Select the unzipped extension directory.

## Documentation

- Privacy Policy: [PRIVACY.md](./PRIVACY.md)

## What's New in 1.2.8

- Improved state stability across repeated scans, auto collection, and page navigation so stale tasks cannot overwrite or clear newer results.
- Fixed stale images remaining after navigation in single-page apps while preserving collection state for ordinary same-page anchor changes.
- Improved synchronization and cleanup of anti-hotlinking request rules so image loading rules do not become stale after clearing, rescanning, or background recovery.
- Improved batch download and split ZIP reliability, including background recovery, image payload validation, and handoff between ZIP parts.
- Completed Comic Mode pagination cancellation: background pagination now stops when Comic Mode closes, results are cleared, the page navigates, or a related tab closes.
- Improved consistency for image metadata updates, format filters, and auto scrolling on long pages, reducing delayed UI updates and repeated probing.

## What's New in 1.2.7

- Added Chinese and English UI support: first install follows the browser language, using Chinese for Chinese or Traditional Chinese browser locales and English for other locales.
- Added a subtle language switch in the Popup header. Manual choices are persisted and then shared by both Popup and Workspace.
- Added Chrome native locale metadata so the extension name and description can follow the browser language.
- Refined the English layout to account for longer labels and avoid squeezed icons, header wrapping, or crowded filter controls.

## What's New in 1.2.6

- Improved Workspace performance for large collections: grid mode now renders only the visible area and buffer range, making fast scrolling smoother with 1000+ images.
- Preserved large-image detection in virtualized grids: images that have not been scrolled into view still continue maximum-size, real-format, and HD-source probing.
- Improved responsive image and background image parsing: better discovery stability for complex `srcset`, CSS background images, and `image-set` cases.
- Fixed some images showing as Unknown format: images without extensions, with format parameters, or from special sources now prefer payload-based format detection.
- Improved Workspace interaction stability: optimized state consistency across scrolling, zooming, filtering, sorting, lightbox, fullscreen, drag selection, and grid/masonry switching.

## What's New in 1.2.5

- Improved consistency between large-image detection and viewing: Workspace now prefers the largest available image already discovered, reducing cases where the grid shows a large size while the lightbox or fullscreen view still uses a thumbnail.
- Enhanced dynamic image collection: Added support for more common lazy-load fields, high-resolution image fields, `picture/srcset`, and background image signals to improve large-image discovery on complex pages.
- Improved continuous comic pagination loading: loading subsequent pages can continue from the previous progress point; temporary loading pages scroll more reliably, and interrupted loads can retry from the interrupted page.
- Improved ZIP packaging reliability: optimized the large-batch ZIP workflow and added ZIP part-size settings in Workspace; Popup ZIP downloads follow the current Workspace setting.
- Improved image format detection and saved filenames: for images without file extensions, with format parameters, or from special sources, the extension is inferred from the image payload to reduce Unknown formats and incorrect extensions.

## What's New in 1.2.4

- Fixed the issue where "thumbnails were not upgraded to original images" in general website scenarios, improving original image extraction compatibility.
- Fixed the issue of missing detection for pagination and the last page in comic mode, improving the stability of continuous page fetching.

## What's New in 1.2.3

- Added "Unlock Right Click" entry to the right-click menu, linked with the Popup toggle state.
- Added layout mode switching in Workspace: Grid (default) / Masonry. Masonry displays images completely in their original proportions.

## What's New in 1.2.2

- Added hide/show image feature: manually hide selected images, added "Hidden" category to the format filter bar.
- General hotlinking compatibility: Automatically sets the correct request headers for external image hosts, supporting more sites with anti-hotlinking mechanisms.
- Enhanced large image fetching: Improved HD rule matching and .webp → .jpg automatic fallback; full-screen viewing behaves consistently with the lightbox.
- Dynamic image size updates: Automatically updates the size display in the grid after the lightbox and full-screen successfully load the large image.
- Enhanced pagination detection: Supports icon-based pagination button recognition.
- Improved pagination detection compatibility: Supports pagination structures of more sites like WordPress.
- Fixed the issue where comic mode banners were incorrectly displayed in basic mode.

## What's New in 1.2.0

- Added Comic Mode (Experimental): One-click entry via right-click menu or Popup, images are arranged according to the original reading order on the page.
- Comic mode supports automatic pagination detection; after user confirmation, it can fetch subsequent pages one by one without manual page turning.
- Added quick entry for Comic Mode in Popup.
- Optimized auto-scroll state synchronization, promptly notifying Popup and Workspace when stopped.

## What's New in 1.1.0

- Added auto-scroll entry in Popup, suitable for handling long lists and infinite scrolling pages in conjunction with auto-collection.
- Optimized the runtime synchronization and recovery behavior after page refresh for auto-collection, auto-scroll, and right-click unlock.
- Added state feedback for batch download and ZIP archiving, making long-task processes easier to observe.
- Large batch ZIP downloads are now automatically output in split volumes, with filenames uniformly styled as `part001.zip`.

## Features

- **Multi-source Collection:** Supports common image sources like `img`, `picture`, `srcset`, common `data-*` lazy loading fields, background images, etc.
- **Incremental Collection:** Supports manual continuous scanning and automatic collection, listens to common lazy-loading fields and dynamically added images, suitable for news feeds, masonry layouts, and infinite scrolling pages.
- **Comic Mode:** Experimental feature, accessible via right-click menu or Popup. Images are arranged in DOM order, supports automatic pagination detection, and loads subsequent pages after user confirmation.
  - Pagination detection is based on heuristic analysis of page structure; some unconventional pagination structures may not be recognized.
  - When loading subsequent pages, the extension attempts to trigger basic lazy loading within the per-page wait limit, but it does not guarantee complete collection on every site.
- **Auto Scroll:** Popup provides an auto-scroll entry, suitable for use with auto-collection for long lists and infinite scroll pages, or can be used independently.
- **Smart Merging:** Automatically regularizes common parameter differences, size variants, and some original image links.
- **Fine-grained Filtering:** Supports format filtering, resolution presets, minimum short edge, minimum long edge, and minimum pixel threshold.
- **Dual Interface Workflow:** Popup is suitable for quick operations, while Workspace is suitable for large-batch filtering and immersive image viewing; both share the same result set for a single tab.
- **Batch Processing:** Supports batch copying of links, sequential batch downloading, and ZIP archiving downloads.
- **Image Viewing:** Supports normal preview, keyboard switching, and Workspace full-screen viewing.
- **Source Traceability:** Supports opening the source page from the collected image.
- **Download Feedback:** Batch download and ZIP archiving processes will display the current progress, making it easy to observe the status of long tasks.
- **Local Execution:** Does not rely on external backend services; data is saved in the browser's local environment.

## Interface Guide

### Popup

Suitable for quickly completing the following operations:

- Scan the current page
- Quickly filter images
- Start auto-scroll
- Batch copy links
- Batch download
- Open Workspace to continue processing
- Enter comic mode
- Enable page right-click unlock

Note: The Popup is a browser extension popup and will close automatically when it loses focus. Auto-collection, auto-scroll, and download tasks that have already started will continue to run in the background, and the results can be viewed later in the Popup or Workspace.

### Workspace

Suitable for handling more complex collection tasks:

- Large batch browsing and filtering
- Selection-style multi-select
- More immersive preview experience
- Full-screen viewing and switching
- Batch downloading and ZIP archiving
- Comic Mode: Reading order arrangement, automatic pagination detection, and loading after user confirmation
- Layout Switching: Supports Grid and Masonry viewing modes
- Hidden images: Hidden state is saved in the current collection session and can be viewed or restored through the "Hidden" filter
- Pick up collected results from Popup, continue filtering and processing

## Usage

### Manual Scanning

- `Scan`: Establish the image result set for the current page.
- `Continue Scanning`: Incrementally add new images to the existing results and update to better versions.
- `Clear`: Empty the current tab's results and establish a new collection result set.

### Auto Collection

- When enabled, it monitors new image nodes added to the page and automatically adds them incrementally to the result set.
- It listens to common lazy-loading fields and dynamically added images; complex sites may still require manual continuous scanning or auto-scroll assistance.
- Suitable for dynamically loaded pages, such as feeds, long lists, and masonry pages.
- It is recommended to perform a manual scan first, then enable auto collection.

### Auto Scroll

- The entry is at the top of the Popup, to the left of "Auto Collect".
- Can be used independently or in conjunction with auto collection.
- Suitable for pages that require continuous loading of content downwards, such as long lists, masonry layouts, and feed pages.
- Once started, even if the Popup is closed, the collection task within the current tab will continue to execute.
- Collection results will continue to be aggregated into the current tab's result set, which can then be directly opened in Workspace for viewing and processing.

### Filtering Capabilities

- Formats: `JPG / PNG / WebP / GIF / SVG / AVIF / Other / Hidden`
- Resolution Presets: `All / ≥720P / ≥1080P / ≥2K / ≥4K`
- Custom Thresholds:
  - Minimum short edge
  - Minimum long edge
  - Minimum pixels (MP)
- Common Toggles:
  - Collect original images
  - Sort large to small
  - Only show vertical images
  - Download as JPG
  - Batch download ZIP
  - Auto scroll (Popup)
  - Auto collect
  - Unlock right-click (Popup / Right-click menu)

## Downloading and Copying

### Single Image Download

- Selects the download source based on the current "Collect Original Image" setting.
- When "Download as JPG" is enabled, it will convert applicable formats to JPG before downloading.

### Batch Download

- In non-ZIP mode, images will be added one by one to the browser's download queue.
- When "Download as JPG" is enabled, it will execute JPG conversion for convertible formats.
- The current progress status will be displayed while the batch task is running.

### Batch ZIP Download

- `Batch Download ZIP` is off by default; enable it manually as needed.
- Batch tasks will output ZIP files, suitable for centralized archiving.
- Large batch tasks will automatically split into volumes and download them sequentially.
- ZIP volume settings are configured in Workspace; ZIP downloads started from Popup use the current global volume setting.
- The packing and downloading process will display the current volume and overall processing progress.
- Filename rules:
  - Single volume: `domain-YYYYMMDD-HHMM-images.zip`
  - Split volumes: `domain-YYYYMMDD-HHMM-images.part001.zip`
- Automatic volume splitting conditions:
  - A single volume reaches approximately `192MB`.
  - Or a single volume reaches `300` images.
- For large batches, the default or more stable volume setting is recommended; extra-large volumes increase memory pressure.

### Copying Strategy

- Prioritizes copying the image itself to the clipboard.
- When browser permissions or format restrictions do not allow it, it automatically falls back to copying the image link.

## Right-Click Menu

- On a blank area of the page (Submenu):
  - Scan images on the current page
  - Scan images on the current page (Comic Mode)
  - Unlock right-click
- On an image element (Submenu):
  - View original image
  - Copy original image
  - Download original image

## Quick Start

1. Open the target web page.
2. Click the extension icon to open the Popup.
3. Click `Scan`.
4. Enable format filtering, resolution presets, or custom thresholds as needed.
5. Perform the following operations as needed:
   - Batch copy links
   - Batch download
   - Open Workspace to continue filtering and viewing

For dynamic pages, it is recommended to perform a manual scan first, then enable auto collection and auto scroll as needed.

## Project Structure

- `manifest.json`: Extension configuration (Manifest V3)
- `background/background.js`: Message scheduling, downloading, packing, right-click menu, runtime coordination
- `background/stateManager.js`: Manages images, selection state, and configuration state by tab
- `content/content.js`: Page scanning, auto collection, auto scroll, page-side capabilities processing
- `popup/*`: Popup interface, quick filtering, and auto-scroll entries
- `workspace/*`: Workspace interface and interactions
- `styles/*`: Style resources

## Permissions Description

- `activeTab` / `scripting`: Inject scripts into the current page and execute collection logic.
- `downloads`: Download single images, batch download, ZIP download.
- `contextMenus`: Provides right-click menu capabilities.
- `storage`: Save tab collection status and interface configuration.
- `clipboardWrite`: Copy images or image links.
- `declarativeNetRequest` / `declarativeNetRequestWithHostAccess`: Handle request compatibility for some image hosts.
- `host_permissions: <all_urls>`: Supports executing collection on the vast majority of common web pages.

## Scope and Limitations

- Browser-restricted pages cannot be injected, such as `chrome://*`, extension management pages, Chrome Web Store, etc.
- Pure Canvas / WebGL rendered content usually cannot directly extract original images.
- Strict anti-hotlinking, temporary signed links, or restricted image hosts may cause original image links to be undownloadable directly.
- Some sites require expanding a details area or loading more content first before obtaining the complete image results.
- Enabling auto collection on large dynamic pages may bring certain performance overheads.
- For pages with login-state restrictions, strict anti-hotlinking, delayed scripts, inner scroll containers, Canvas / Blob content, or virtualized lists, the extension can only make a best-effort collection of accessible resources.
- Subsequent page loading keeps user confirmation and will not automatically fetch unlimited pages after entering Comic Mode.
- The Popup is limited by the browser extension popup mechanism and will close automatically when it loses focus; long-term observation, batch filtering, and centralized processing are recommended to be completed in the Workspace.
- Large batch ZIP downloads will consume more browser resources; the number of volumes and time taken will vary with the volume of images on the page.

## Version Info

- Version: `1.2.8`
- Manifest: `MV3`
