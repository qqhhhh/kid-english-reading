export function describePdfImportProgress(elapsedSeconds: number) {
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = String(elapsedSeconds % 60).padStart(2, "0");
  const elapsed = minutes > 0 ? `${minutes}:${seconds}` : `${elapsedSeconds}s`;
  if (elapsedSeconds < 12) return { label: `读取 PDF · ${elapsed}`, hint: "正在提取文字层和页面布局" };
  if (elapsedSeconds < 90) return { label: `本地 OCR · ${elapsed}`, hint: "正在逐页识别，整本教材通常需要约 1 分钟" };
  if (elapsedSeconds < 240) return { label: `云端复核 · ${elapsed}`, hint: "本地结果已完成，正在等待讯飞与日日新并行返回" };
  return { label: `等待上游 · ${elapsed}`, hint: "服务仍在运行；上游超时会自动跳过，不会阻断本地结果" };
}
