import { evaluatePass } from "./passGate.js";
import { applyScorePolicy } from "./scoringPolicy.js";

const defaultShadowTimeoutMs = 25_000;

function safeTimeoutMs(value) {
  const timeout = Number(value);
  return Number.isFinite(timeout) ? Math.min(60_000, Math.max(3_000, timeout)) : defaultShadowTimeoutMs;
}

function summarize(result, gate) {
  return {
    passed: Boolean(gate?.passed),
    suggestedScore: Number(result?.SuggestedScore || 0),
    providerSuggestedScore: Number(result?.ProviderSuggestedScore ?? result?.SuggestedScore ?? 0),
    pronAccuracy: Number(result?.PronAccuracy || 0),
    pronFluency: Number(result?.PronFluency || 0),
    pronCompletion: Number(result?.PronCompletion || 0),
    severeIssues: Number(gate?.severeIssues || 0),
    lowAccuracyIssues: Number(gate?.lowAccuracyIssues || 0),
    providerRejected: Boolean(result?.ProviderRejected),
    providerExceptionCode: Number(result?.ProviderExceptionCode || 0)
  };
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Shadow provider timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

export function getSpeechProviderComparisonStatus(primaryProvider) {
  const shadowProvider = process.env.SPEECH_SHADOW_PROVIDER?.trim() || "";
  const enabled = Boolean(shadowProvider && shadowProvider !== primaryProvider && primaryProvider !== "mock");
  return {
    enabled,
    mode: enabled ? "shadow" : "disabled",
    primaryProvider,
    shadowProvider: shadowProvider || undefined,
    timeoutMs: safeTimeoutMs(process.env.SPEECH_SHADOW_TIMEOUT_MS),
    configured:
      shadowProvider === "azure"
        ? Boolean(process.env.AZURE_SPEECH_KEY?.trim() && process.env.AZURE_SPEECH_REGION?.trim())
        : shadowProvider === "xfyun"
          ? Boolean(
              process.env.XFYUN_APP_ID?.trim() &&
              process.env.XFYUN_API_KEY?.trim() &&
              process.env.XFYUN_API_SECRET?.trim()
            )
          : Boolean(shadowProvider)
  };
}

export async function assessSpeechProviderComparison({
  primaryProvider,
  primaryResult,
  primaryGate,
  primaryDurationMs,
  referenceText,
  durationMs,
  audio,
  minScore,
  assess
}) {
  const status = getSpeechProviderComparisonStatus(primaryProvider);
  if (!status.enabled) return undefined;

  const comparedAt = new Date().toISOString();
  const base = {
    mode: "shadow",
    comparedAt,
    primary: {
      provider: primaryProvider,
      status: "success",
      durationMs: Number(primaryDurationMs || 0),
      ...summarize(primaryResult, primaryGate)
    }
  };
  const startedAt = performance.now();

  try {
    const providerResult = await withTimeout(
      assess({
        provider: status.shadowProvider,
        referenceText,
        durationMs,
        audio
      }),
      status.timeoutMs
    );
    const result = applyScorePolicy(providerResult);
    const evaluatedGate = evaluatePass(result, Number(minScore || 75));
    const gate = providerResult?.ProviderRejected ? { ...evaluatedGate, passed: false, providerRejected: true } : evaluatedGate;
    return {
      ...base,
      shadow: {
        provider: status.shadowProvider,
        status: "success",
        durationMs: Math.round(performance.now() - startedAt),
        ...summarize(result, gate),
        result
      }
    };
  } catch (error) {
    return {
      ...base,
      shadow: {
        provider: status.shadowProvider,
        status: "error",
        durationMs: Math.round(performance.now() - startedAt),
        error: error?.message || String(error)
      }
    };
  }
}
