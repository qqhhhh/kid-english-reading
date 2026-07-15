import { ArrowLeft, ExternalLink, Home, RefreshCw, RotateCcw } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { getInitialLocale } from "../../lib/i18n";
import {
  getInitialLayoutPreview,
  isLayoutPreview,
  layoutPreviewHints,
  layoutPreviewLabels,
  layoutPreviewProfiles,
  storeLayoutPreview,
  type LayoutPreview
} from "../../lib/layoutPreview";
import { LayoutSwitcher } from "../ui/LayoutSwitcher";
import { ThemeSwitcher } from "../ui/ThemeSwitcher";
import { useDesignTheme } from "./DesignThemeContext";

type PreviewSurface = "child" | "parent";

function getInitialPreviewLayout() {
  const requested = new URLSearchParams(window.location.search).get("device");
  return isLayoutPreview(requested) ? requested : getInitialLayoutPreview();
}

function getSafeInitialTarget() {
  const params = new URLSearchParams(window.location.search);
  const rawTarget = params.get("target") || "/practice";
  try {
    const target = new URL(rawTarget, window.location.origin);
    if (target.origin !== window.location.origin || !["/practice", "/parent"].includes(target.pathname)) {
      return "/practice";
    }
    target.searchParams.delete("devicePreview");
    return `${target.pathname}${target.search}`;
  } catch {
    return "/practice";
  }
}

function withEmbeddedPreviewFlag(target: string) {
  const url = new URL(target, window.location.origin);
  url.searchParams.set("devicePreview", "1");
  return `${url.pathname}${url.search}`;
}

function buildSurfaceTargets(initialTarget: string) {
  const url = new URL(initialTarget, window.location.origin);
  const childId = url.searchParams.get("childId") || "";
  const childTarget = url.pathname === "/practice" ? initialTarget : `/practice${childId ? `?childId=${encodeURIComponent(childId)}` : ""}`;
  const parentParams = new URLSearchParams();
  if (childId) parentParams.set("childId", childId);
  parentParams.set("section", "practice");
  const parentTarget = url.pathname === "/parent" ? initialTarget : `/parent?${parentParams.toString()}`;
  return { child: childTarget, parent: parentTarget } satisfies Record<PreviewSurface, string>;
}

export function DevicePreviewStudio() {
  const locale = getInitialLocale();
  const initialTarget = useMemo(getSafeInitialTarget, []);
  const targets = useMemo(() => buildSurfaceTargets(initialTarget), [initialTarget]);
  const [surface, setSurface] = useState<PreviewSurface>(() => (initialTarget.startsWith("/parent") ? "parent" : "child"));
  const [layout, setLayout] = useState<LayoutPreview>(getInitialPreviewLayout);
  const [reloadKey, setReloadKey] = useState(0);
  const [availableSize, setAvailableSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const { theme, chrome } = useDesignTheme();
  const profile = layoutPreviewProfiles[layout];
  const framePadding = profile.kind === "desktop" ? 18 : 24;
  const naturalWidth = profile.width + framePadding;
  const naturalHeight = profile.height + framePadding;
  const scale =
    availableSize.width > 0 && availableSize.height > 0
      ? Math.min(
          1,
          Math.max(0.25, (availableSize.width - 24) / naturalWidth),
          Math.max(0.25, (availableSize.height - 24) / naturalHeight)
        )
      : 1;
  const target = targets[surface];
  const iframeSource = withEmbeddedPreviewFlag(target);

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) return;
    const updateSize = () => setAvailableSize({ width: element.clientWidth, height: element.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function changeLayout(nextLayout: LayoutPreview) {
    setLayout(nextLayout);
    storeLayoutPreview(nextLayout);
  }

  return (
    <main className="device-preview-studio">
      <header className="device-preview-toolbar">
        <div className="device-preview-toolbar__title">
          <button className="ui-preview-icon-button" onClick={() => window.location.assign(target)} type="button" aria-label="返回页面">
            <ArrowLeft size={19} />
          </button>
          <div>
            <strong>{locale === "zh" ? "设备实机预览" : "Device viewport preview"}</strong>
            <small>
              {layoutPreviewLabels[layout][locale]} · {layoutPreviewHints[layout]} · {Math.round(scale * 100)}%
            </small>
          </div>
        </div>

        <div className="device-preview-toolbar__controls">
          <div className="device-preview-surface-tabs" role="group" aria-label={locale === "zh" ? "预览页面" : "Preview surface"}>
            <button className={surface === "child" ? "active" : ""} onClick={() => setSurface("child")} type="button">
              {locale === "zh" ? "学生端" : "Student"}
            </button>
            <button className={surface === "parent" ? "active" : ""} onClick={() => setSurface("parent")} type="button">
              {locale === "zh" ? "家长端" : "Parent"}
            </button>
          </div>
          <LayoutSwitcher compact={false} locale={locale} value={layout} onChange={changeLayout} />
          <ThemeSwitcher locale={locale} />
          <button className="ui-preview-action-button" onClick={() => setReloadKey((value) => value + 1)} type="button">
            <RefreshCw size={17} />
            {locale === "zh" ? "刷新" : "Reload"}
          </button>
          <button className="ui-preview-action-button" onClick={() => window.open(target, "_blank", "noopener,noreferrer")} type="button">
            <ExternalLink size={17} />
            {locale === "zh" ? "原页面" : "Open page"}
          </button>
        </div>
      </header>

      <section className="device-preview-stage" ref={stageRef}>
        <div className="device-preview-size-guide" style={{ width: naturalWidth * scale, height: naturalHeight * scale }}>
          <div
            className={`device-preview-frame device-preview-frame--${profile.kind}`}
            style={{
              width: naturalWidth,
              height: naturalHeight,
              transform: `scale(${scale})`
            }}
          >
            {profile.kind !== "desktop" ? <span className="device-preview-camera" aria-hidden="true" /> : null}
            <iframe
              allow="autoplay; microphone"
              key={`${surface}-${layout}-${theme}-${chrome}-${reloadKey}`}
              src={iframeSource}
              style={{ width: profile.width, height: profile.height }}
              title={`${layoutPreviewLabels[layout][locale]} ${surface === "child" ? "学生端" : "家长端"}`}
            />
          </div>
        </div>
      </section>

      <footer className="device-preview-help">
        <Home size={16} />
        <span>{locale === "zh" ? "iframe 使用真实 CSS 视口；麦克风、滚动和响应式断点都按所选设备尺寸运行。" : "The iframe uses a real CSS viewport, including responsive breakpoints, scrolling, and microphone access."}</span>
        <button onClick={() => changeLayout("desktop")} type="button">
          <RotateCcw size={15} />
          {locale === "zh" ? "恢复桌面" : "Reset desktop"}
        </button>
      </footer>
    </main>
  );
}
