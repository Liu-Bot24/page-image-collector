import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { buildZipBlob } from '../shared/zipCore.js';

const source = readFileSync(new URL('../offscreen/offscreen.js', import.meta.url), 'utf8');
const partSource = source.slice(source.indexOf('const requestPartDownload ='), source.indexOf('const runZipTask ='));
for (const success of [true, false]) {
  test(`ZIP releases input buffers while awaiting download and preserves its Blob (${success})`, async () => {
    let finish; let archive; let revoked = false; let started;
    const ready = new Promise(resolve => { started = resolve; });
    const context = vm.createContext({
      buildZipBlob, buildBatchZipPartFilename: () => 'test.zip', sendProgress: async () => {},
      MSG: { OFFSCREEN_ZIP_PART_READY: 'READY' },
      createPartDoneWaiter: () => ({ promise: new Promise(resolve => { finish = resolve; }), cancel() {} }),
      URL: { createObjectURL: blob => { archive = blob; return 'blob:zip'; }, revokeObjectURL: () => { revoked = true; } },
      chrome: { runtime: { sendMessage: async () => { started(); return { success: true }; } } }
    });
    vm.runInContext(partSource + '\nglobalThis.download = requestPartDownload;', context);
    const content = new TextEncoder().encode('original image bytes');
    const entries = [{ filename: 'image.png', bytes: content }];
    const task = { taskId: 'task', tabId: 1, downloadedParts: 0, zipFileNames: [], total: 1, processed: 1 };
    const done = context.download(task, entries); await ready;
    const released = entries.length === 0;
    content.fill(0);
    const archiveBytes = new Uint8Array(await archive.arrayBuffer());
    assert.ok(new TextDecoder().decode(archiveBytes).includes('original image bytes'));
    assert.equal(revoked, false);
    finish({ success });
    assert.equal((await done).success, success);
    assert.equal(revoked, true);
    assert.equal(task.downloadedParts, success ? 1 : 0);
    assert.equal(released, true, 'the waiting download must not retain copied image buffers');
  });
}
