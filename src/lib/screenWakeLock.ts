export type ScreenWakeLockHandle = {
  released?: boolean;
  release: () => Promise<void>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: {
    request: (type: "screen") => Promise<ScreenWakeLockHandle>;
  };
};

export async function requestScreenWakeLock() {
  const wakeLock = (navigator as WakeLockNavigator).wakeLock;
  if (!wakeLock || document.visibilityState !== "visible") return null;
  try {
    return await wakeLock.request("screen");
  } catch {
    return null;
  }
}

export async function releaseScreenWakeLock(handle: ScreenWakeLockHandle | null) {
  if (!handle || handle.released) return;
  try {
    await handle.release();
  } catch {
    // The browser may have released it already when the page was hidden.
  }
}
