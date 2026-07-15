import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json";

function createBuildId() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

const buildId = process.env.KID_READING_BUILD_ID || createBuildId();

export default defineConfig({
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version),
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId)
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["app-icon.svg", "app-icon-192.png", "app-icon-512.png"],
      manifest: {
        name: "Kid English Reading",
        short_name: "英语跟读",
        description: "面向家庭的少儿英语听读、跟读与发音练习。",
        lang: "zh-CN",
        start_url: "/practice",
        scope: "/",
        display: "standalone",
        background_color: "#fff6ec",
        theme_color: "#fff6ec",
        categories: ["education", "kids"],
        icons: [
          { src: "/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ],
        shortcuts: [
          { name: "开始练习", short_name: "练习", url: "/practice" },
          { name: "家长控制台", short_name: "家长端", url: "/parent" }
        ]
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globIgnores: ["**/vad/**"],
        cleanupOutdatedCaches: true,
        clientsClaim: false,
        skipWaiting: false
      }
    }),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js",
          dest: "vad"
        },
        {
          src: "node_modules/@ricky0123/vad-web/dist/silero_vad_legacy.onnx",
          dest: "vad"
        },
        {
          src: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
          dest: "vad"
        },
        {
          src: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs",
          dest: "vad"
        }
      ]
    })
  ],
  server: {
    watch: {
      ignored: ["**/tmp/**"]
    },
    proxy: {
      "/api": process.env.KID_READING_API_PROXY || "http://127.0.0.1:4175"
    }
  }
});
