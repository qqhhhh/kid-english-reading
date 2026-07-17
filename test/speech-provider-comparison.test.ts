import assert from "node:assert/strict";
import test from "node:test";

import {
  assessSpeechProviderComparison,
  getSpeechProviderComparisonStatus
} from "../server/speechProviderComparison.js";
import type { ProviderAssessmentResult, ProviderWordResult } from "../server/types/providers.js";

function providerWord(referenceWord: string, accuracy: number, matchTag: number): ProviderWordResult {
  return {
    Word: referenceWord,
    ReferenceWord: referenceWord,
    PronAccuracy: accuracy,
    PronFluency: 1,
    MatchTag: matchTag,
    PhoneInfos: []
  };
}

const primaryResult: ProviderAssessmentResult = {
  SuggestedScore: 83,
  PronAccuracy: 82,
  PronFluency: 0.8,
  PronCompletion: 1,
  Words: [providerWord("can", 90, 0)]
};
const primaryGate = { passed: true, severeIssues: 0, lowAccuracyIssues: 0 };

test("shadow comparison is disabled unless a different provider is configured", () => {
  const previous = process.env.SPEECH_SHADOW_PROVIDER;
  delete process.env.SPEECH_SHADOW_PROVIDER;
  assert.equal(getSpeechProviderComparisonStatus("tencent").enabled, false);
  process.env.SPEECH_SHADOW_PROVIDER = "tencent";
  assert.equal(getSpeechProviderComparisonStatus("tencent").enabled, false);
  if (previous === undefined) delete process.env.SPEECH_SHADOW_PROVIDER;
  else process.env.SPEECH_SHADOW_PROVIDER = previous;
});

test("captures a policy-normalized shadow result without changing the primary result", async () => {
  const previous = process.env.SPEECH_SHADOW_PROVIDER;
  process.env.SPEECH_SHADOW_PROVIDER = "azure";
  const comparison = await assessSpeechProviderComparison({
    primaryProvider: "tencent",
    primaryResult,
    primaryGate,
    primaryDurationMs: 420,
    referenceText: "Can you help?",
    durationMs: 1800,
    audio: Buffer.from([1]),
    minScore: 75,
    assess: async () => ({
      SuggestedScore: 91,
      PronAccuracy: 90,
      PronFluency: 0.9,
      PronCompletion: 2 / 3,
      Words: [
        providerWord("can", 92, 0),
        providerWord("you", 90, 0),
        providerWord("help", 0, 2)
      ]
    })
  });
  assert.ok(comparison);
  assert.equal(comparison.primary.suggestedScore, 83);
  assert.equal(primaryResult.SuggestedScore, 83);
  assert.equal(comparison.shadow.status, "success");
  if (comparison.shadow.status !== "success") assert.fail("Expected a successful shadow comparison.");
  assert.equal(comparison.shadow.result.ProviderSuggestedScore, 91);
  assert.equal(comparison.shadow.result.SuggestedScore, 0);
  assert.equal(comparison.shadow.passed, false);
  if (previous === undefined) delete process.env.SPEECH_SHADOW_PROVIDER;
  else process.env.SPEECH_SHADOW_PROVIDER = previous;
});

test("captures shadow failures instead of rejecting the primary attempt", async () => {
  const previous = process.env.SPEECH_SHADOW_PROVIDER;
  process.env.SPEECH_SHADOW_PROVIDER = "azure";
  const comparison = await assessSpeechProviderComparison({
    primaryProvider: "tencent",
    primaryResult,
    primaryGate,
    primaryDurationMs: 420,
    referenceText: "Can you help?",
    durationMs: 1800,
    audio: Buffer.from([1]),
    minScore: 75,
    assess: async () => {
      throw new Error("Azure unavailable");
    }
  });
  assert.ok(comparison);
  assert.equal(comparison.primary.status, "success");
  assert.equal(comparison.shadow.status, "error");
  if (comparison.shadow.status !== "error") assert.fail("Expected a failed shadow comparison.");
  assert.match(comparison.shadow.error, /Azure unavailable/);
  if (previous === undefined) delete process.env.SPEECH_SHADOW_PROVIDER;
  else process.env.SPEECH_SHADOW_PROVIDER = previous;
});

test("detects configured XFYUN shadow credentials", () => {
  const previous = {
    provider: process.env.SPEECH_SHADOW_PROVIDER,
    appId: process.env.XFYUN_APP_ID,
    apiKey: process.env.XFYUN_API_KEY,
    apiSecret: process.env.XFYUN_API_SECRET
  };
  process.env.SPEECH_SHADOW_PROVIDER = "xfyun";
  process.env.XFYUN_APP_ID = "test-app";
  process.env.XFYUN_API_KEY = "test-key";
  process.env.XFYUN_API_SECRET = "test-secret";

  const status = getSpeechProviderComparisonStatus("tencent");
  assert.equal(status.enabled, true);
  assert.equal(status.configured, true);
  assert.equal(status.shadowProvider, "xfyun");

  for (const [key, value] of Object.entries({
    SPEECH_SHADOW_PROVIDER: previous.provider,
    XFYUN_APP_ID: previous.appId,
    XFYUN_API_KEY: previous.apiKey,
    XFYUN_API_SECRET: previous.apiSecret
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test("forces a provider-rejected shadow result to fail without affecting primary", async () => {
  const previous = process.env.SPEECH_SHADOW_PROVIDER;
  process.env.SPEECH_SHADOW_PROVIDER = "xfyun";
  const comparison = await assessSpeechProviderComparison({
    primaryProvider: "tencent",
    primaryResult,
    primaryGate,
    primaryDurationMs: 420,
    referenceText: "Can you help?",
    durationMs: 1800,
    audio: Buffer.from([1]),
    minScore: 75,
    assess: async () => ({
      SuggestedScore: 90,
      PronAccuracy: 92,
      PronFluency: 0.9,
      PronCompletion: 1,
      ProviderRejected: true,
      ProviderExceptionCode: 28680,
      Words: [providerWord("can", 92, 0)]
    })
  });

  assert.ok(comparison);
  assert.equal(comparison.primary.passed, true);
  if (comparison.shadow.status !== "success") assert.fail("Expected a successful shadow comparison.");
  assert.equal(comparison.shadow.passed, false);
  assert.equal(comparison.shadow.providerRejected, true);
  assert.equal(comparison.shadow.providerExceptionCode, 28680);
  if (previous === undefined) delete process.env.SPEECH_SHADOW_PROVIDER;
  else process.env.SPEECH_SHADOW_PROVIDER = previous;
});
