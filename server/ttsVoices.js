export const tencentTtsVoices = [
  {
    id: "501008",
    provider: "tencent",
    name: "WeJames",
    description: "English male",
    modelType: 1,
    voiceType: 501008,
    primaryLanguage: 2,
    category: "large-model",
    subtitleSupport: "timed"
  },
  {
    id: "501009",
    provider: "tencent",
    name: "WeWinny",
    description: "English female",
    modelType: 1,
    voiceType: 501009,
    primaryLanguage: 2,
    category: "large-model",
    subtitleSupport: "timed"
  },
  {
    id: "602003",
    provider: "tencent",
    name: "Ai Xiaoyou",
    description: "Super-natural chat female voice",
    modelType: 1,
    voiceType: 602003,
    primaryLanguage: 2,
    category: "super-natural",
    subtitleSupport: "timed"
  },
  {
    id: "502007",
    provider: "tencent",
    name: "Zhi Xiaohu",
    description: "Super-natural child voice",
    modelType: 1,
    voiceType: 502007,
    primaryLanguage: 2,
    category: "super-natural-child",
    subtitleSupport: "none"
  }
];

export function getDefaultTtsVoice() {
  return (
    tencentTtsVoices.find((voice) => voice.id === "602003") ||
    tencentTtsVoices[0]
  );
}

export function findTtsVoice(voiceId) {
  if (!voiceId) {
    return getDefaultTtsVoice();
  }

  return tencentTtsVoices.find((voice) => voice.id === voiceId);
}
