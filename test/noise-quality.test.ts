import assert from "node:assert/strict";
import test from "node:test";
import { evaluateNoiseGate } from "../server/noiseQuality.js";

test("a cleaned recording with stable assessment remains scoreable", () => {
  const decision = evaluateNoiseGate({
    enhancement: {
      applied: true,
      overallReductionDb: 2,
      noiseFloorReductionDb: 8,
      speechRetentionDb: -2,
      output: { estimatedSnrDb: 24, rms: 0.08 }
    },
    enhancedResult: { SuggestedScore: 86, PronCompletion: 1 },
    rawResult: { SuggestedScore: 76, PronCompletion: 1 }
  });
  assert.equal(decision.rejected, false);
});

test("residual heavy noise rejects scoring instead of manufacturing a score", () => {
  const decision = evaluateNoiseGate({
    enhancement: {
      applied: true,
      overallReductionDb: 3,
      noiseFloorReductionDb: 4,
      speechRetentionDb: -2,
      output: { estimatedSnrDb: 4, rms: 0.05 }
    },
    enhancedResult: { SuggestedScore: 80, PronCompletion: 1 },
    rawResult: { SuggestedScore: 74, PronCompletion: 1 }
  });
  assert.equal(decision.rejected, true);
  assert.equal(decision.reason, "residual-noise-too-high");
});

test("over-suppressed speech rejects scoring", () => {
  const decision = evaluateNoiseGate({
    enhancement: {
      applied: true,
      overallReductionDb: 10,
      noiseFloorReductionDb: 16,
      speechRetentionDb: -14,
      output: { estimatedSnrDb: 30, rms: 0.03 }
    },
    enhancedResult: { SuggestedScore: 90, PronCompletion: 1 },
    rawResult: { SuggestedScore: 52, PronCompletion: 0.5 }
  });
  assert.equal(decision.rejected, true);
  assert.equal(decision.reason, "speech-over-suppressed");
});
