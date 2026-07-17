import assert from "node:assert/strict";
import test from "node:test";

import { createSingleFlight } from "../server/singleFlight.js";

test("single flight shares concurrent work for the same key", async () => {
  const singleFlight = createSingleFlight<string, number>();
  let calls = 0;
  let release: ((value: number) => void) | undefined;
  const task = () => {
    calls += 1;
    return new Promise<number>((resolve) => {
      release = resolve;
    });
  };

  const first = singleFlight.run("word", task);
  const second = singleFlight.run("word", task);
  assert.equal(calls, 1);
  assert.equal(singleFlight.size(), 1);
  release?.(7);
  assert.deepEqual(await Promise.all([first, second]), [7, 7]);
  assert.equal(singleFlight.size(), 0);
});

test("single flight releases failed work so a retry can run", async () => {
  const singleFlight = createSingleFlight<string, number>();
  let calls = 0;
  await assert.rejects(singleFlight.run("word", async () => {
    calls += 1;
    throw new Error("failed");
  }));
  assert.equal(await singleFlight.run("word", async () => {
    calls += 1;
    return 8;
  }), 8);
  assert.equal(calls, 2);
});
