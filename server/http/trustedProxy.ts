import type { Application } from "express";

interface TrustedProxyOptions {
  nodeEnv?: string;
  configuredValue?: string;
}

export function resolveTrustedProxySetting({
  nodeEnv = process.env.NODE_ENV,
  configuredValue = process.env.HTTP_TRUST_PROXY
}: TrustedProxyOptions = {}): string | false {
  const value = String(configuredValue || "").trim();
  if (!value) return nodeEnv === "production" ? "loopback" : false;
  if (["0", "false", "off", "none"].includes(value.toLocaleLowerCase())) return false;
  if (["1", "true", "on"].includes(value.toLocaleLowerCase())) {
    throw new Error("HTTP_TRUST_PROXY must name a trusted subnet such as 'loopback'; an unrestricted proxy is unsafe");
  }
  return value;
}

export function configureTrustedProxy(app: Application, options: TrustedProxyOptions = {}): void {
  app.set("trust proxy", resolveTrustedProxySetting(options));
}
