import type { TtsSynthesisRequest, TtsSynthesisResult } from "../types/providers.js";

export async function synthesizeWithOpenAI(_request?: TtsSynthesisRequest): Promise<TtsSynthesisResult> {
  throw new Error("OpenAI TTS provider is reserved but not implemented yet. Set TTS_PROVIDER=tencent for now.");
}
