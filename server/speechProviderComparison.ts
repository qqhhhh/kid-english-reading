import { evaluatePass } from "./passGate.js";
import { applyScorePolicy } from "./scoringPolicy.js";
import type {
  ProviderAssessmentResult,
  SpeechComparisonInput,
  SpeechProviderComparisonStatus,
  SpeechProviderSummary
} from "./types/providers.js";
import type { PassGateResult } from "./types/scoring.js";

const defaultShadowTimeoutMs = 25_000;

interface SuccessfulProviderComparison extends SpeechProviderSummary {
  provider?: string;
  status: "success";
  durationMs: number;
}

interface ShadowProviderSuccess extends SuccessfulProviderComparison {
  result: ProviderAssessmentResult;
}

interface ShadowProviderError {
  provider?: string;
  status: "error";
  durationMs: number;
  error: string;
}

export interface SpeechProviderComparisonResult {
  mode: "shadow";
  comparedAt: string;
  primary: SuccessfulProviderComparison;
  shadow: ShadowProviderSuccess | ShadowProviderError;
}

function safeTimeoutMs(value: unknown): number {
  const timeout = Number(value);
  return Number.isFinite(timeout) ? Math.min(60_000, Math.max(3_000, timeout)) : defaultShadowTimeoutMs;
}

function summarize(
  result: ProviderAssessmentResult,
  gate: Pick<PassGateResult, "passed"> & Partial<PassGateResult>
): SpeechProviderSummary {
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
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

export function getSpeechProviderComparisonStatus(primaryProvider: string): SpeechProviderComparisonStatus {
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
  itemType,
  durationMs,
  audio,
  minScore,
  assess
}: SpeechComparisonInput): Promise<SpeechProviderComparisonResult | undefined> {
  const status = getSpeechProviderComparisonStatus(primaryProvider);
  if (!status.enabled) return undefined;

  const comparedAt = new Date().toISOString();
  const base = {
    mode: "shadow" as const,
    comparedAt,
    primary: {
      provider: primaryProvider,
      status: "success" as const,
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
        itemType,
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
  } catch (error: unknown) {
    return {
      ...base,
      shadow: {
        provider: status.shadowProvider,
        status: "error",
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
