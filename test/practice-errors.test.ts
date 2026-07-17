import assert from "node:assert/strict";
import test from "node:test";

import { classifyPracticeIssue, getPracticeIssue } from "../src/lib/practiceErrors.ts";

test("distinguishes microphone permission denial from an unavailable device", () => {
  assert.equal(classifyPracticeIssue({ name: "NotAllowedError" }, "microphone"), "microphone-denied");
  assert.equal(classifyPracticeIssue({ name: "NotReadableError" }, "microphone"), "microphone-unavailable");
});

test("keeps recording quality failures separate from scoring service failures", () => {
  assert.equal(classifyPracticeIssue({ code: "capture-gap" }, "recording"), "recording-interrupted");
  assert.equal(classifyPracticeIssue({ code: "NO_SPEECH_DETECTED" }, "scoring"), "recording-no-speech");
  assert.equal(classifyPracticeIssue({ code: "RECORDING_TOO_NOISY" }, "scoring"), "recording-too-noisy");
});

test("distinguishes scoring quota, timeout, offline, and service errors", () => {
  assert.equal(classifyPracticeIssue({ status: 429 }, "scoring"), "scoring-quota");
  assert.equal(classifyPracticeIssue({ message: "Tencent speech provider timed out" }, "scoring"), "network-timeout");
  assert.equal(classifyPracticeIssue(new TypeError("Failed to fetch"), "scoring"), "network-unavailable");
  assert.equal(classifyPracticeIssue(new Error("server failed"), "scoring", false), "network-offline");
  assert.equal(classifyPracticeIssue(new Error("provider failed"), "scoring"), "scoring-service");
});

test("provides an explicit next action without exposing raw provider errors", () => {
  const issue = getPracticeIssue(new Error("Tencent speech error 12345: secret provider detail"), "scoring", "zh", true);
  assert.equal(issue.kind, "scoring-service");
  assert.match(issue.action, /^下一步：/);
  assert.doesNotMatch(`${issue.title}${issue.message}${issue.action}`, /12345|secret provider detail/);
});
