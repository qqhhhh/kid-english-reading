export function VersionBadge() {
  if (window.location.pathname.startsWith("/preview")) return null;

  const appVersion = import.meta.env.VITE_APP_VERSION;
  const buildId = import.meta.env.VITE_BUILD_ID;
  const fullVersion = `测试版 v${appVersion} · 构建 ${buildId}`;

  return (
    <div className="app-version-badge" aria-label={fullVersion} title={fullVersion}>
      <span>测试版</span>
      <strong>v{appVersion}</strong>
      <small>{buildId}</small>
    </div>
  );
}
