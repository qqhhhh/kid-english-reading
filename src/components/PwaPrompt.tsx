import { Download, RefreshCw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaPrompt() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const updateServiceWorkerRef = useRef<(reloadPage?: boolean) => Promise<void>>(async () => undefined);
  const english = localStorage.getItem("kid-reading-locale") === "en";

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let active = true;
    void import("virtual:pwa-register").then(({ registerSW }) => {
      if (!active) return;
      updateServiceWorkerRef.current = registerSW({
        immediate: true,
        onNeedRefresh: () => setNeedsRefresh(true)
      });
    });
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    return () => {
      active = false;
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    };
  }, []);

  if (!needsRefresh && !installPrompt) return null;

  const title = needsRefresh
    ? english
      ? "A new version is ready"
      : "新版本已经准备好"
    : english
      ? "Install on this device"
      : "安装到这台设备";

  async function confirm() {
    if (needsRefresh) {
      await updateServiceWorkerRef.current(true);
      return;
    }
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <aside className="pwa-prompt" role="status">
      {needsRefresh ? <RefreshCw size={19} /> : <Download size={19} />}
      <strong>{title}</strong>
      <button className="pwa-prompt__confirm" onClick={() => void confirm()} type="button">
        {needsRefresh ? (english ? "Update" : "立即更新") : english ? "Install" : "安装"}
      </button>
      <button
        aria-label={english ? "Dismiss" : "暂不处理"}
        className="pwa-prompt__dismiss"
        onClick={() => {
          setNeedsRefresh(false);
          setInstallPrompt(null);
        }}
        type="button"
      >
        <X size={17} />
      </button>
    </aside>
  );
}
