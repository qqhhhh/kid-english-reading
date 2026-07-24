import type { Application } from "express";
import type { Server } from "node:http";

export interface ServerAttachment {
  close(): void | Promise<void>;
}

interface StartApplicationServerOptions {
  app: Application;
  host: string;
  port: number;
  onListening?: () => void;
  attachServer?: (server: Server) => ServerAttachment | void;
  cleanup?: () => void | Promise<void>;
  shutdownTimeoutMs?: number;
  installSignalHandlers?: boolean;
}

export interface RunningApplicationServer {
  server: Server;
  shutdown(reason?: string): Promise<void>;
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function startApplicationServer({
  app,
  host,
  port,
  onListening,
  attachServer,
  cleanup,
  shutdownTimeoutMs = 10_000,
  installSignalHandlers = true
}: StartApplicationServerOptions): RunningApplicationServer {
  const server = app.listen(port, host, onListening);
  const attachment = attachServer?.(server);
  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  let shutdownPromise: Promise<void> | null = null;

  const removeSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    signalHandlers.clear();
  };

  const shutdown = (reason = "manual"): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      removeSignalHandlers();
      console.info(JSON.stringify({ level: "info", event: "server.shutdown.started", reason }));
      server.closeIdleConnections();
      let gracefulError: unknown;
      const gracefulClose = Promise.all([
        closeHttpServer(server),
        Promise.resolve(attachment?.close())
      ]).catch((error) => {
        gracefulError = error;
      });
      let timedOut = false;
      let timeout: NodeJS.Timeout | undefined;
      await Promise.race([
        gracefulClose,
        new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            timedOut = true;
            server.closeAllConnections();
            resolve();
          }, shutdownTimeoutMs);
        })
      ]);
      if (timeout) clearTimeout(timeout);
      try {
        await cleanup?.();
      } catch (error) {
        process.exitCode = 1;
        console.error(JSON.stringify({
          level: "error",
          event: "server.shutdown.cleanup-failed",
          reason,
          message: error instanceof Error ? error.message : String(error)
        }));
      }
      if (timedOut) {
        process.exitCode = 1;
        console.error(JSON.stringify({ level: "error", event: "server.shutdown.forced", reason, shutdownTimeoutMs }));
      } else {
        console.info(JSON.stringify({ level: "info", event: "server.shutdown.completed", reason }));
      }
      if (gracefulError) throw gracefulError;
    })();
    return shutdownPromise;
  };

  if (installSignalHandlers) {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] satisfies NodeJS.Signals[]) {
      const handler = () => {
        void shutdown(signal).catch((error) => {
          process.exitCode = 1;
          console.error(JSON.stringify({
            level: "error",
            event: "server.shutdown.failed",
            reason: signal,
            message: error instanceof Error ? error.message : String(error)
          }));
        });
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    }
  }

  return { server, shutdown };
}
