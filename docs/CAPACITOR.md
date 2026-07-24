# Capacitor 移动端外壳验证

当前仓库已经加入 Capacitor 8 的基础配置，但**还没有生成 Android 或 iOS 工程**，因此不会影响网页构建、本机开发服务或现有数据库。

## 当前结论

- 现有 React + Vite 页面可以直接复用为 Capacitor WebView 内容。
- Android 需要 JDK 21、Android Studio 与 Android SDK；本机当前只有 `adb`，环境不完整。
- iOS 必须使用 macOS、Xcode 和 Apple Developer 配置，不能在当前 Windows 机器完成签名构建。
- 当前前端 API 使用 `/api` 相对路径。打包本地静态资源前，需要使用部署者自己的稳定 HTTPS API 地址。

## 两种验证方式

### 远程网页壳（最快验证）

设置 `CAPACITOR_SERVER_URL` 为稳定 HTTPS 网站地址后同步原生工程。WebView 会直接加载远程网页，适合内部测试，但不作为最终商店方案。

### 本地资源壳（正式方向）

把 `dist/` 打进 App，前端通过独立环境变量访问稳定 API。这个方向打开更快，也能显示离线外壳，但需要先完成 API Base URL 改造。

## Android 环境齐备后的命令

```powershell
npm install @capacitor/android
npx cap add android
npm run build
npm run cap:sync
npx cap doctor
npx cap open android
```

执行生产构建前仍需遵守 `PROJECT_STATUS.md`：先备份正式服务器数据，再通过正式部署流程更新，不在本机恢复旧测试服务。
