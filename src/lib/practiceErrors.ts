export type PracticeOperation = "microphone" | "recording" | "tts" | "scoring";

export type PracticeIssueKind =
  | "microphone-denied"
  | "microphone-unavailable"
  | "recording-interrupted"
  | "recording-too-short"
  | "recording-too-quiet"
  | "recording-no-speech"
  | "recording-too-noisy"
  | "audio-blocked"
  | "tts-failed"
  | "network-offline"
  | "network-timeout"
  | "network-unavailable"
  | "scoring-quota"
  | "scoring-service";

export type PracticeIssue = {
  kind: PracticeIssueKind;
  title: string;
  message: string;
  action: string;
};

type ErrorDetails = {
  name: string;
  message: string;
  code: string;
  status?: number;
};

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
};

const issueCopy: Record<"zh" | "en", Record<PracticeIssueKind, Omit<PracticeIssue, "kind">>> = {
  zh: {
    "microphone-denied": {
      title: "麦克风未授权",
      message: "浏览器阻止了录音，当前无法开始跟读。",
      action: "下一步：点“重新申请”；若没有弹窗，请在地址栏的网站设置中允许麦克风。"
    },
    "microphone-unavailable": {
      title: "麦克风不可用",
      message: "没有找到可用麦克风，或麦克风正被其他应用占用。",
      action: "下一步：关闭占用麦克风的应用，确认使用 HTTPS 打开页面，然后重新申请。"
    },
    "recording-interrupted": {
      title: "录音已中断",
      message: "录音过程中出现了声音断层，不能可靠评分。",
      action: "下一步：让页面保持在前台，不要锁屏或切换应用，再完整读一遍。"
    },
    "recording-too-short": {
      title: "录音太短",
      message: "这次录音没有覆盖完整句子。",
      action: "下一步：听完原音后把整句读完，再点完成。"
    },
    "recording-too-quiet": {
      title: "声音太轻",
      message: "录音音量不足，系统没有听清朗读。",
      action: "下一步：靠近麦克风，在安静环境中稍大声地再读一遍。"
    },
    "recording-no-speech": {
      title: "没有听到有效朗读",
      message: "这次录音中没有检测到可用于评分的英语朗读。",
      action: "下一步：等提示开始后，对着麦克风完整读一遍。"
    },
    "recording-too-noisy": {
      title: "环境声音太大",
      message: "背景噪音会影响逐词判断，本次没有继续评分。",
      action: "下一步：换到安静位置并靠近麦克风，再读一遍。"
    },
    "audio-blocked": {
      title: "需要点击播放",
      message: "浏览器阻止了自动播放原音。",
      action: "下一步：点页面中央的“播放原音”，播放后会继续录音。"
    },
    "tts-failed": {
      title: "原音暂时无法播放",
      message: "合成语音服务或音频加载失败。",
      action: "下一步：检查网络后再点一次“听原音”；仍然失败请稍后重试。"
    },
    "network-offline": {
      title: "网络已断开",
      message: "当前操作未完成，页面暂时无法连接所需服务。",
      action: "下一步：恢复 Wi-Fi 或移动网络，确认页面已联网后再试。"
    },
    "network-timeout": {
      title: "网络或服务响应超时",
      message: "本次请求在等待时间内没有返回结果。",
      action: "下一步：确认网络稳定后重试一次；不要连续快速点击。"
    },
    "network-unavailable": {
      title: "无法连接服务",
      message: "浏览器没有连上评分服务。",
      action: "下一步：检查网络或切换 Wi-Fi 后重试；仍失败请稍后再练。"
    },
    "scoring-quota": {
      title: "评分服务额度不足",
      message: "评分账户可能达到额度、频率或计费限制。",
      action: "下一步：先暂停练习，请家长或管理员检查评分服务额度后再试。"
    },
    "scoring-service": {
      title: "评分服务暂时不可用",
      message: "录音已完成，但评分服务没有成功返回结果。",
      action: "下一步：稍等片刻后重试一次；持续失败时请保留时间和句子信息反馈。"
    }
  },
  en: {
    "microphone-denied": {
      title: "Microphone access is blocked",
      message: "The browser did not allow this page to record.",
      action: "Next: try again. If no prompt appears, allow the microphone in this site's browser settings."
    },
    "microphone-unavailable": {
      title: "Microphone unavailable",
      message: "No usable microphone was found, or another app is using it.",
      action: "Next: close other recording apps, make sure this page uses HTTPS, and try again."
    },
    "recording-interrupted": {
      title: "Recording interrupted",
      message: "The audio contains a gap and cannot be scored reliably.",
      action: "Next: keep this page in front, do not lock the screen, and read the whole line again."
    },
    "recording-too-short": {
      title: "Recording too short",
      message: "The recording did not cover the full sentence.",
      action: "Next: listen once, read the whole sentence, then tap Finish."
    },
    "recording-too-quiet": {
      title: "Voice too quiet",
      message: "The recording was not loud enough to understand clearly.",
      action: "Next: move closer to the microphone and read a little louder in a quiet place."
    },
    "recording-no-speech": {
      title: "No valid reading detected",
      message: "The recording did not contain usable English speech.",
      action: "Next: wait for the prompt, then read the whole line into the microphone."
    },
    "recording-too-noisy": {
      title: "Too much background noise",
      message: "The noise would make word-level scoring unreliable.",
      action: "Next: move somewhere quieter, stay close to the microphone, and try again."
    },
    "audio-blocked": {
      title: "Tap to play the example",
      message: "The browser blocked automatic audio playback.",
      action: "Next: tap Play example in the center. Recording will continue after it plays."
    },
    "tts-failed": {
      title: "Example audio unavailable",
      message: "The speech service or audio download failed.",
      action: "Next: check the network and tap Listen again. If it still fails, try again later."
    },
    "network-offline": {
      title: "You are offline",
      message: "This action did not finish because the required service cannot be reached.",
      action: "Next: reconnect Wi-Fi or mobile data, confirm this page is online, and try again."
    },
    "network-timeout": {
      title: "Network or service timed out",
      message: "This request did not return a result in time.",
      action: "Next: check that the network is stable and retry once. Avoid tapping repeatedly."
    },
    "network-unavailable": {
      title: "Cannot reach the service",
      message: "The browser could not connect to the scoring service.",
      action: "Next: check or switch networks and retry. If it persists, continue later."
    },
    "scoring-quota": {
      title: "Scoring quota unavailable",
      message: "The scoring account may have reached a quota, rate, or billing limit.",
      action: "Next: pause practice and ask a parent or administrator to check the scoring-service quota."
    },
    "scoring-service": {
      title: "Scoring service unavailable",
      message: "Recording completed, but the scoring service did not return a result.",
      action: "Next: wait briefly and retry once. If it persists, report the time and sentence."
    }
  }
};

function readErrorDetails(error: unknown): ErrorDetails {
  const value = error && typeof error === "object" ? error as ErrorLike : {};
  return {
    name: String(value.name || ""),
    message: String(value.message || error || ""),
    code: String(value.code || "").toUpperCase(),
    ...(Number.isFinite(Number(value.status)) ? { status: Number(value.status) } : {})
  };
}

export function classifyPracticeIssue(
  error: unknown,
  operation: PracticeOperation,
  online = true
): PracticeIssueKind {
  const details = readErrorDetails(error);
  const normalized = `${details.code} ${details.message}`.toLowerCase();

  if (operation === "microphone") {
    return ["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(details.name)
      ? "microphone-denied"
      : "microphone-unavailable";
  }

  if (details.code === "CAPTURE-GAP") return "recording-interrupted";
  if (details.code === "TOO-SHORT") return "recording-too-short";
  if (details.code === "TOO-QUIET") return "recording-too-quiet";
  if (details.code === "NO-SPEECH" || details.code === "NO_SPEECH_DETECTED") return "recording-no-speech";
  if (details.code === "RECORDING_TOO_NOISY") return "recording-too-noisy";

  if (operation === "tts") {
    if (["NotAllowedError", "SecurityError"].includes(details.name) || details.code === "AUDIO_BLOCKED") {
      return "audio-blocked";
    }
    if (!online) return "network-offline";
    if (details.name === "AbortError" || /timed?\s*out|timeout/.test(normalized)) return "network-timeout";
    return "tts-failed";
  }

  if (!online) return "network-offline";
  if (
    details.status === 429 ||
    /quota|rate.?limit|limit.?exceeded|billing|balance|resource.?exhausted|额度|欠费|余额不足/.test(normalized)
  ) {
    return "scoring-quota";
  }
  if (
    details.name === "AbortError" ||
    details.status === 408 ||
    details.status === 504 ||
    details.code === "NETWORK_TIMEOUT" ||
    /timed?\s*out|timeout/.test(normalized)
  ) {
    return "network-timeout";
  }
  if (
    details.name === "TypeError" ||
    details.code === "NETWORK_ERROR" ||
    /failed to fetch|networkerror|network request failed|load failed/.test(normalized)
  ) {
    return "network-unavailable";
  }
  return "scoring-service";
}

export function getPracticeIssue(
  error: unknown,
  operation: PracticeOperation,
  locale: "zh" | "en" = "zh",
  online = typeof navigator === "undefined" ? true : navigator.onLine
): PracticeIssue {
  const kind = classifyPracticeIssue(error, operation, online);
  return { kind, ...issueCopy[locale][kind] };
}
