import type { CapacitorConfig } from "@capacitor/cli";

const remoteUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: "cn.family.kidenglishreading",
  appName: "英语跟读",
  webDir: "dist",
  backgroundColor: "#fff6ec",
  android: {
    backgroundColor: "#fff6ec"
  },
  server: remoteUrl
    ? {
        url: remoteUrl,
        cleartext: false
      }
    : undefined
};

export default config;
