import { Copy, Link2, Smartphone, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createChildPairingCode, fetchChildDevices, fetchChildren, revokeChildDevice, type ChildDevice } from "../../lib/api";
import type { ChildProfile } from "../../lib/types";

export function ChildDeviceManager({ onClose }: { onClose: () => void }) {
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [devices, setDevices] = useState<ChildDevice[]>([]);
  const [childId, setChildId] = useState("");
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string; link: string; qr: string } | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [busy, setBusy] = useState(false);

  async function reloadDevices() { setDevices(await fetchChildDevices()); }
  useEffect(() => { void Promise.all([fetchChildren(), fetchChildDevices()]).then(([nextChildren, nextDevices]) => { setChildren(nextChildren); setDevices(nextDevices); setChildId(nextChildren[0]?.id || ""); }); }, []);
  useEffect(() => {
    if (!pairing) return;
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  async function generate() {
    if (!childId) return;
    setBusy(true);
    try {
      const result = await createChildPairingCode(childId);
      const link = `${window.location.origin}/login?mode=child&pair=${result.code}&next=%2Fpractice`;
      const { toDataURL } = await import("qrcode");
      setPairing({ ...result, link, qr: await toDataURL(link, { width: 220, margin: 1, color: { dark: "#5f341f", light: "#fffaf5" } }) });
      await reloadDevices();
    } finally { setBusy(false); }
  }

  return (
    <div className="child-device-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="child-device-modal" role="dialog" aria-modal="true" aria-label="学生设备管理">
        <header><div><Smartphone size={22} /><div><h2>学生设备</h2><p>生成一次性配对码，学生不需要知道家长密码。</p></div></div><button onClick={onClose} type="button" aria-label="关闭"><X /></button></header>
        <div className="child-device-create">
          <label>选择学生<select value={childId} onChange={(event) => setChildId(event.target.value)}>{children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</select></label>
          <button disabled={!childId || busy} onClick={() => void generate()} type="button"><Link2 size={17} />{busy ? "生成中…" : "生成10分钟配对码"}</button>
        </div>
        {pairing ? <div className={`child-pairing-result ${remainingSeconds === 0 ? "expired" : ""}`}><img alt="学生设备配对二维码" src={pairing.qr} /><div><small>{remainingSeconds > 0 ? `剩余 ${Math.floor(remainingSeconds / 60)}:${String(remainingSeconds % 60).padStart(2, "0")}` : "登录码已过期"}</small><strong>{pairing.code}</strong><p>登录码只能使用一次，登录成功后立即失效。</p><button disabled={remainingSeconds === 0} onClick={() => void navigator.clipboard.writeText(pairing.link)} type="button"><Copy size={15} />复制登录链接</button></div></div> : null}
        <div className="child-device-list"><h3>已配对设备</h3>{devices.filter((device) => !device.revokedAt).length ? devices.filter((device) => !device.revokedAt).map((device) => <article key={device.id}><div><strong>{device.childName}</strong><span>{device.label || "学生设备"} · {new Date(device.createdAt).toLocaleDateString()}</span></div><button onClick={() => void revokeChildDevice(device.id).then(reloadDevices)} type="button">撤销</button></article>) : <p>还没有已配对设备。</p>}</div>
      </section>
    </div>
  );
}
