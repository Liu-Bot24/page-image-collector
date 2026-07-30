import test from "node:test";
import assert from "node:assert/strict";

import { createComicPaginationJobManager } from "../background/comicPaginationJobs.js";

test("starting a new pagination job cancels the old job and closes its temporary tab", async () => {
  const closedTabs = [];
  const manager = createComicPaginationJobManager({
    closeTab: async (tabId) => {
      closedTabs.push(tabId);
    }
  });

  const first = manager.start(11);
  await first.ready;
  assert.equal(manager.attachTemporaryTab(11, first, 901), true);

  const second = manager.start(11);
  await first.cancellation;
  await second.ready;

  assert.equal(first.cancelled, true);
  assert.equal(manager.isCurrent(11, first), false);
  assert.equal(manager.isCurrent(11, second), true);
  assert.deepEqual(closedTabs, [901]);
});

test("explicit cancellation stops the current pagination job", async () => {
  const closedTabs = [];
  const manager = createComicPaginationJobManager({
    closeTab: async (tabId) => {
      closedTabs.push(tabId);
    }
  });

  const job = manager.start(22, "workspace-b");
  await job.ready;
  assert.equal(manager.attachTemporaryTab(22, job, 902), true);

  assert.equal(await manager.cancel(22, "workspace-a"), false);
  assert.equal(manager.isCurrent(22, job), true);
  assert.deepEqual(closedTabs, []);

  const cancelled = await manager.cancel(22, "workspace-b");
  await job.cancellation;

  assert.equal(cancelled, true);
  assert.equal(manager.isCurrent(22, job), false);
  assert.deepEqual(closedTabs, [902]);
});

test("finishing an old job cannot remove its replacement", async () => {
  const manager = createComicPaginationJobManager();
  const first = manager.start(33);
  await first.ready;
  const second = manager.start(33);
  await second.ready;

  assert.equal(manager.finish(33, first), false);
  assert.equal(manager.isCurrent(33, second), true);
  assert.equal(manager.finish(33, second), true);
  assert.equal(manager.isCurrent(33, second), false);
});

test("closing the requester tab cancels only jobs owned by that workspace", async () => {
  const closedTabs = [];
  const manager = createComicPaginationJobManager({
    closeTab: async (tabId) => {
      closedTabs.push(tabId);
    }
  });
  const first = manager.start(41, "workspace-a", 501);
  const second = manager.start(42, "workspace-b", 502);
  await Promise.all([first.ready, second.ready]);
  manager.attachTemporaryTab(41, first, 911);
  manager.attachTemporaryTab(42, second, 912);

  assert.equal(await manager.cancelByRequesterTab(501), 1);
  assert.equal(manager.isCurrent(41, first), false);
  assert.equal(manager.isCurrent(42, second), true);
  assert.deepEqual(closedTabs, [911]);
});
