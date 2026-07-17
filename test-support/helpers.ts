import type { Server } from "node:net";

export function listeningPort(server: Pick<Server, "address">): number {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected the test server to listen on a TCP port.");
  }
  return address.port;
}

export async function responseJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function cookieFromResponse(response: Response, name: string): string {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  return (values.find((value) => value.startsWith(`${name}=`)) || "").split(";")[0] || "";
}
