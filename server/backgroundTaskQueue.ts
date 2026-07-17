export interface BackgroundTaskQueueOptions {
  concurrency?: number;
  maxPending?: number;
  onError?: (error: unknown) => void;
}

export function createBackgroundTaskQueue({
  concurrency = 1,
  maxPending = 8,
  onError = () => undefined
}: BackgroundTaskQueueOptions = {}) {
  const workerCount = Number.isFinite(concurrency) ? Math.max(1, Math.floor(concurrency)) : 1;
  const pendingLimit = Number.isFinite(maxPending) ? Math.max(0, Math.floor(maxPending)) : 8;
  const pending: Array<() => Promise<void>> = [];
  let active = 0;

  const drain = () => {
    while (active < workerCount && pending.length > 0) {
      const task = pending.shift();
      if (!task) return;
      active += 1;
      void task().catch(onError).finally(() => {
        active -= 1;
        drain();
      });
    }
  };

  return {
    enqueue(task: () => Promise<void>) {
      if (active + pending.length >= workerCount + pendingLimit) return false;
      pending.push(task);
      queueMicrotask(drain);
      return true;
    },
    status() {
      return { active, pending: pending.length, concurrency: workerCount, maxPending: pendingLimit };
    }
  };
}
