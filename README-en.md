<div align="center">

# Page Image Collector

![Page Image Collector preview](assets/github-preview.jpg)

Languages: [简体中文](README.md) · [English](README-en.md)

</div>

A Chrome extension for daily browsing scenarios, used to quickly collect web page images, providing capabilities for filtering, viewing, batch copying, batch downloading, and ZIP archiving.

## Installation

### Install from Chrome Web Store (Recommended)

[Page Image Collector - Chrome Web Store](https://chromewebstore.google.com/detail/%E5%9B%BE%E7%89%87%E9%87%87%E9%9B%86%E6%9F%A5%E7%9C%8B%E5%99%A8/jchjkamalmegomjijigapilnecdccbom)

### Install from GitHub Releases

1. Go to the project's `Releases` page.
2. Download the unpacked zip for the corresponding version, e.g., `page-image-collector-1.2.4-unpacked.zip`.
3. Open `chrome://extensions/`.
4. Enable "Developer mode".
5. Unzip the downloaded ZIP file.
6. Click "Load unpacked".
7. Select the unzipped extension directory.

## Documentation

- Privacy Policy: [PRIVACY.md](./PRIVACY.md)

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
- Comic mode supports automatic pagination detection and page-by-page fetching of subsequent images without manual page turning.
- Added quick entry for Comic Mode in Popup.
- Optimized auto-scroll state synchronization, promptly notifying Popup and Workspace when stopped.

## What's New in 1.1.0

- Added auto-scroll entry in Popup, suitable for handling long lists and infinite scrolling pages in conjunction with auto-collection.
- Optimized the runtime synchronization and recovery behavior after page refresh for auto-collection, auto-scroll, and right-click unlock.
- Added state feedback for batch download and ZIP archiving, making long-task processes easier to observe.
- Large batch ZIP downloads are now automatically output in split volumes, with filenames uniformly styled as `part001.zip`.

## Features

- **Multi-source Collection:** Supports common image sources like `img`, `picture`, `srcset`, common `data-*` lazy loading fields, background images, etc.
- **Incremental Collection:** Supports manual continuous scanning and automatic collection, suitable for news feeds, masonry layouts, and infinite scrolling pages.
- **Comic Mode:** Experimental feature, accessible via right-click menu or Popup. Images are arranged in DOM order, supports automatic pagination detection and sequential loading of subsequent page images.
  - Pagination detection is based on heuristic analysis of page structure; some unconventional pagination structures may not be recognized.
  - When automatically fetching subsequent pages, only loaded image content on each page is collected; if the target page relies on scrolling to trigger lazy loading, images that have not entered the viewport may not be collected.
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
- Comic Mode: Reading order arrangement, automatic pagination detection, and loading
- Layout Switching: Supports Grid and Masonry viewing modes
- Pick up collected results from Popup, continue filtering and processing

## Usage

### Manual Scanning

- `Scan`: Establish the image result set for the current page.
- `Continue Scanning`: Incrementally add new images to the existing results and update to better versions.
- `Clear`: Empty the current tab's results and establish a new collection result set.

### Auto Collection

- When enabled, it monitors new image nodes added to the page and automatically adds them incrementally to the result set.
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
- The packing and downloading process will display the current volume and overall processing progress.
- Filename rules:
  - Single volume: `domain-YYYYMMDD-HHMM-images.zip`
  - Split volumes: `domain-YYYYMMDD-HHMM-images.part001.zip`
- Automatic volume splitting conditions:
  - A single volume reaches approximately `192MB`.
  - Or a single volume reaches `300` images.

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
- The Popup is limited by the browser extension popup mechanism and will close automatically when it loses focus; long-term observation, batch filtering, and centralized processing are recommended to be completed in the Workspace.
- Large batch ZIP downloads will consume more browser resources; the number of volumes and time taken will vary with the volume of images on the page.

## Version Info

- Version: `1.2.4`
- Manifest: `MV3`
