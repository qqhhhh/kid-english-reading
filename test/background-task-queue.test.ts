import assert from "node:assert/strict";
import test from "node:test";

import { createBackgroundTaskQueue } from "../server/backgroundTaskQueue.js";

test("background queue respects concurrency and drains pending work", async () => {
  const queue = createBackgroundTaskQueue({ concurrency: 1, maxPending: 2 });
  const order: string[] = [];
  let release: (() => void) | undefined;
  const firstDone = new Promise<void>((resolve) => {
    release = resolve;
  });
  let allDone: (() => void) | undefined;
  const completed = new Promise<void>((resolve) => {
    allDone = resolve;
  });

  assert.equal(queue.enqueue(async () => {
    order.push("first-start");
    await firstDone;
    order.push("first-end");
  }), true);
  assert.equal(queue.enqueue(async () => {
    order.push("second");
    allDone?.();
  }), true);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.deepEqual(order, ["first-start"]);
  release?.();
  await completed;
  assert.deepEqual(order, ["first-start", "first-end", "second"]);
});

test("background queue rejects excess buffered work", async () => {
  const queue = createBackgroundTaskQueue({ concurrency: 1, maxPending: 0 });
  let release: (() => void) | undefined;
  const running = new Promise<void>((resolve) => {
    release = resolve;
  });
  assert.equal(queue.enqueue(() => running), true);
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  assert.equal(queue.enqueue(async () => undefined), false);
  release?.();
});
