export function createSingleFlight<Key, Value>() {
  const inFlight = new Map<Key, Promise<Value>>();

  return {
    run(key: Key, task: () => Promise<Value>): Promise<Value> {
      const existing = inFlight.get(key);
      if (existing) return existing;

      const promise = task();
      inFlight.set(key, promise);
      promise.then(
        () => {
          if (inFlight.get(key) === promise) inFlight.delete(key);
        },
        () => {
          if (inFlight.get(key) === promise) inFlight.delete(key);
        }
      );
      return promise;
    },
    size() {
      return inFlight.size;
    }
  };
}
