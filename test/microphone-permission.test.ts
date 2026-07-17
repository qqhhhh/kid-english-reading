import assert from "node:assert/strict";
import test from "node:test";

import { probeMicrophoneAccess } from "../src/lib/microphonePermission.ts";

test("warms up microphone permission and immediately releases the track", async () => {
  let stopped = false;
  const state = await probeMicrophoneAccess({
    secureContext: true,
    permissions: { query: async () => ({ state: "prompt" }) },
    mediaDevices: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => { stopped = true; } }] })
    }
  });

  assert.equal(state, "granted");
  assert.equal(stopped, true);
});

test("does not repeatedly prompt when microphone permission is already denied", async () => {
  let requested = false;
  const state = await probeMicrophoneAccess({
    secureContext: true,
    permissions: { query: async () => ({ state: "denied" }) },
    mediaDevices: { getUserMedia: async () => { requested = true; throw new Error("unexpected"); } }
  });

  assert.equal(state, "denied");
  assert.equal(requested, false);
});

test("reports unavailable microphone outside a secure browser context", async () => {
  const state = await probeMicrophoneAccess({ secureContext: false });
  assert.equal(state, "unavailable");
});
