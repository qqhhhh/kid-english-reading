import { expect, test, type Page } from "@playwright/test";

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
  expect(dimensions.scrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.innerWidth + 2);
  expect(dimensions.bodyScrollWidth, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.innerWidth + 2);
}

const words = [
  { Word: "My", ReferenceWord: "My", PronAccuracy: 92, PronFluency: 0.9, MatchTag: 0, PhoneInfos: [] },
  { Word: "friends", ReferenceWord: "friends", PronAccuracy: 54, PronFluency: 0.72, MatchTag: 0, PhoneInfos: [] },
  { Word: "are", ReferenceWord: "are", PronAccuracy: 0, PronFluency: 0, MatchTag: 2, PhoneInfos: [] },
  { Word: "special", ReferenceWord: "special", PronAccuracy: 87, PronFluency: 0.86, MatchTag: 0, PhoneInfos: [] }
];

const attempt = {
  id: "attempt-diagnostic-preview-001",
  childId: "diagnostic-child",
  childName: "小航",
  sentenceId: "sentence-diagnostic-preview",
  referenceText: "My friends are special.",
  createdAt: "2026-07-15T09:35:12.000Z",
  speechProvider: "tencent",
  audioBytes: 48120,
  audioAvailable: false,
  rawAudioAvailable: false,
  passed: false,
  severeIssues: 1,
  extraIssues: 0,
  unscoredIssues: 0,
  lowAccuracyIssues: 2,
  minWordAccuracy: 0,
  sourceType: "lesson",
  contentId: "diagnostic-lesson",
  contentTitle: "PEP 四年级上册",
  result: { SuggestedScore: 0, ProviderSuggestedScore: 78, PronAccuracy: 73, PronFluency: 0.82, PronCompletion: 0.75, Words: words },
  recordingQuality: {
    inputSampleRate: 48000,
    rawDurationMs: 3260,
    processedDurationMs: 2870,
    voiceDurationMs: 2120,
    peak: 0.183,
    rms: 0.0312,
    silenceTrimmedMs: 390,
    captureMode: "audio-worklet",
    capturedDurationMs: 3251,
    captureGapMs: 9,
    vadSegmentCount: 1,
    candidateCount: 1,
    audioInput: {
      supported: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: true, channelCount: true },
      applied: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, sampleRate: 48000, channelCount: 1 }
    }
  },
  clientDevice: {
    userAgent: "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1",
    platform: "iPad",
    language: "zh-CN",
    viewport: { width: 820, height: 1180 },
    screen: { width: 820, height: 1180 },
    devicePixelRatio: 2,
    maxTouchPoints: 5,
    online: true,
    connection: { effectiveType: "4g", rtt: 80, downlink: 12 }
  },
  candidateSelection: {
    strategy: "full-session",
    selectedId: "full-session",
    selectedKind: "full-session",
    candidateCount: 1,
    evaluated: [{ id: "full-session", kind: "full-session", durationMs: 2870, passed: false, suggestedScore: 0, pronAccuracy: 73, pronCompletion: 0.75, severeIssues: 1, lowAccuracyIssues: 2, enhancementApplied: true, assessmentDurationMs: 934 }]
  },
  speechEnhancement: {
    provider: "gtcrn",
    applied: true,
    processingMs: 143,
    output: { estimatedSnrDb: 14.6 },
    speechRetentionDb: -1.8,
    overallReductionDb: 4.2,
    noiseGate: { rejected: false, outputSnrDb: 14.6 }
  },
  speechProviderComparison: {
    mode: "shadow",
    comparedAt: "2026-07-15T09:35:14.000Z",
    primary: { provider: "tencent", status: "success", durationMs: 934, passed: false, suggestedScore: 0, providerSuggestedScore: 78, pronAccuracy: 73, pronCompletion: 0.75 },
    shadow: {
      provider: "xfyun",
      status: "success",
      durationMs: 1280,
      passed: false,
      suggestedScore: 61,
      providerSuggestedScore: 61,
      pronAccuracy: 66,
      pronCompletion: 0.75,
      result: {
        SuggestedScore: 61,
        ProviderSuggestedScore: 61,
        PronAccuracy: 66,
        PronFluency: 0.76,
        PronCompletion: 0.75,
        Words: [
          words[0],
          { ...words[1], PronAccuracy: 68 },
          { ...words[2], MatchTag: 3, Word: "a" },
          { ...words[3], PronAccuracy: 75 }
        ]
      }
    }
  },
  calibration: { label: "missed", note: "第三个单词漏读", reviewedAt: "2026-07-15T10:00:00.000Z", reviewedBy: { id: "parent-preview", username: "preview_parent" } }
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({ json: {
    authenticated: true,
    session: { kind: "parent", user: { id: "parent-preview", username: "preview_parent", role: "parent" }, household: { id: "household-preview", name: "预览家庭" } }
  } }));
  await page.route("**/api/admin/lessons**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/children", (route) => route.fulfill({ json: [{
    id: "diagnostic-child",
    name: "小航",
    practiceBooks: [],
    practiceItems: []
  }] }));
  await page.route("**/api/progress**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/automatic-practice-sessions**", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/admin/attempt-diagnostics**", (route) => route.fulfill({ json: {
    attempts: [attempt],
    hasMore: false,
    limit: 100,
    calibrationSummary: {
      totalSamples: 12,
      reviewed: 8,
      unreviewed: 4,
      labels: { correct: 3, missed: 2, misread: 1, silent: 1, noise: 1, other: 0 },
      providers: {
        tencent: { evaluated: 7, mismatches: 2, falseAccepts: 1, falseRejects: 1, unavailable: 1, errorRate: 28.57 },
        xfyun: { evaluated: 6, mismatches: 1, falseAccepts: 1, falseRejects: 0, unavailable: 2, errorRate: 16.67 }
      }
    }
  } }));
});

test("parent scoring diagnostics remain usable without horizontal overflow", async ({ page }, testInfo) => {
  await page.goto("/parent?section=diagnostics", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "定位每一次评分差异" })).toBeVisible();
  await expect(page.getByText("attempt-diagnostic-preview-001").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "逐词结果" })).toBeVisible();
  await expectNoPageOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("scoring-diagnostics.png"), fullPage: true });
});
