import { Cpu, Eye, Home, KeyRound, LogIn, LogOut, ShieldCheck, Smartphone } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  fetchParentSession,
  loginParentAccount,
  logoutParentAccount,
  ParentAuthError,
  pairChildDevice,
  registerParentAccount,
  type AccessSession
} from "../../lib/api";
import { ChildDeviceManager } from "./ChildDeviceManager";

type AccessMode = "login" | "register" | "child";

const errorMessages: Record<string, string> = {
  AUTH_RATE_LIMITED: "尝试次数过多，请稍后再试。",
  LOGIN_INVALID: "用户名或密码不正确。",
  USERNAME_INVALID: "用户名需为3到24位，可使用中文、字母、数字、下划线或短横线。",
  USERNAME_TAKEN: "这个用户名已经被使用。",
  PASSWORD_INVALID: "密码需为8到72个字符。",
  REGISTRATION_KEY_INVALID: "注册 Key 不正确。",
  REGISTRATION_KEY_EXPIRED: "注册 Key 已过期。",
  REGISTRATION_KEY_USED: "注册 Key 已经使用过。",
  AUTH_FAILED: "暂时无法完成认证，请稍后重试。",
  CHILD_PAIR_CODE_INVALID: "配对码不正确、已使用或已经过期。"
};

function safeNextPath() {
  const requested = new URLSearchParams(window.location.search).get("next") || "/practice";
  if (!requested.startsWith("/") || requested.startsWith("//") || requested.startsWith("/login")) return "/practice";
  return requested;
}

function currentProtectedPath() {
  const path = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return path === "/" ? "/practice" : path;
}

export function AuthenticatedRoute({ children, showSessionControls = false }: { children: ReactNode; showSessionControls?: boolean }) {
  const [session, setSession] = useState<AccessSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [showDevices, setShowDevices] = useState(false);
  const isLocalHost = import.meta.env.DEV && ["127.0.0.1", "localhost", "::1"].includes(window.location.hostname);

  useEffect(() => {
    let active = true;
    void fetchParentSession()
      .then((nextSession) => {
        if (!active) return;
        if (!nextSession) {
          const next = encodeURIComponent(currentProtectedPath());
          window.location.replace(`/login?next=${next}`);
          return;
        }
        if (showSessionControls && nextSession.kind !== "parent") {
          const next = encodeURIComponent(currentProtectedPath());
          window.location.replace(`/login?next=${next}&parent=1`);
          return;
        }
        setSession(nextSession);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (checking || !session) return <main className="parent-access-page" aria-label="正在检查登录状态" />;

  return (
    <div className="parent-authenticated-shell">
      {children}
      {showSessionControls && session.kind === "parent" ? (
        <div className="parent-session-chip">
          <span><ShieldCheck size={16} />{session.user.username}</span>
          <button onClick={() => window.location.assign("/parent")} type="button"><Home size={15} />家长页面</button>
          {session.user.role === "platform_admin" ? <button onClick={() => window.location.assign("/admin")} type="button"><ShieldCheck size={15} />平台管理</button> : null}
          {session.user.role === "platform_admin" && isLocalHost ? <button onClick={() => window.location.assign("/local-course-studio")} type="button"><Cpu size={15} />本机课程制作</button> : null}
          <button onClick={() => setShowDevices(true)} type="button"><Smartphone size={15} />学生设备</button>
          <button
            onClick={() => {
              void logoutParentAccount().finally(() => window.location.replace("/login"));
            }}
            type="button"
          >
            <LogOut size={15} />退出
          </button>
        </div>
      ) : null}
      {showDevices ? <ChildDeviceManager onClose={() => setShowDevices(false)} /> : null}
    </div>
  );
}

export function LoginPage() {
  const [checking, setChecking] = useState(true);
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<AccessMode>(params.get("mode") === "child" ? "child" : "login");
  const [registrationKey, setRegistrationKey] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pairingCode, setPairingCode] = useState(params.get("pair") || "");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchParentSession()
      .then((session) => {
        if (!active || !session) return;
        const next = safeNextPath();
        if (session.kind === "parent" || !next.startsWith("/parent")) window.location.replace(session.kind === "child" ? "/practice" : next);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "login") await loginParentAccount(username, password);
      else if (mode === "register") await registerParentAccount({ registrationKey, householdName, username, password });
      else await pairChildDevice(pairingCode, deviceLabel);
      window.location.replace(mode === "child" ? "/practice" : safeNextPath());
    } catch (requestError) {
      const code = requestError instanceof ParentAuthError ? requestError.code : "AUTH_FAILED";
      setError(errorMessages[code] || errorMessages.AUTH_FAILED);
      setSubmitting(false);
    }
  }

  if (checking) return <main className="parent-access-page" aria-label="正在检查登录状态" />;

  return (
    <main className="parent-access-page">
      <section className="parent-access-card">
        <div className="parent-access-mark">{mode === "login" ? <LogIn size={30} /> : mode === "register" ? <KeyRound size={30} /> : <Smartphone size={30} />}</div>
        <small>英语跟读家庭版</small>
        <h1>{mode === "login" ? "欢迎回来" : mode === "register" ? "使用邀请 Key 创建家庭" : "学生登录"}</h1>
        <p>{mode === "login" ? "登录后继续进入学生端或家长端。" : mode === "register" ? "无需手机号或邮箱，Key 使用后会自动失效。" : "输入家长生成的6位登录码，这台设备以后可直接练习。"}</p>

        <div className="parent-access-tabs" role="tablist">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">登录</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">Key 注册</button>
          <button className={mode === "child" ? "active" : ""} onClick={() => setMode("child")} type="button">学生登录</button>
        </div>

        <form onSubmit={submit}>
          {mode === "register" ? (
            <>
              <label>注册 Key<input autoCapitalize="characters" autoComplete="one-time-code" onChange={(event) => setRegistrationKey(event.target.value)} placeholder="KID-XXXX-XXXX-XXXX-XXXX" required value={registrationKey} /></label>
              <label>家庭名称（可选）<input autoComplete="organization" maxLength={40} onChange={(event) => setHouseholdName(event.target.value)} placeholder="例如：小宇的家" value={householdName} /></label>
            </>
          ) : null}
          {mode === "child" ? <><label>6位登录码<input autoComplete="one-time-code" inputMode="numeric" maxLength={6} minLength={6} onChange={(event) => setPairingCode(event.target.value.replace(/\D/g, ""))} required value={pairingCode} /></label><label>设备名称（可选）<input maxLength={40} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="例如：客厅 iPad" value={deviceLabel} /></label></> : <><label>用户名<input autoComplete="username" minLength={3} onChange={(event) => setUsername(event.target.value)} required value={username} /></label><label>密码<input autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} /></label></>}
          {error ? <div className="parent-access-error" role="alert">{error}</div> : null}
          <button className="parent-access-submit" disabled={submitting} type="submit">
            {submitting ? "请稍候…" : mode === "login" ? "登录并继续" : mode === "register" ? "创建家庭并继续" : "登录学生端"}
          </button>
        </form>
        <button className="parent-filing-review-link" onClick={() => window.location.assign("/filing-review")} type="button">
          <Eye size={17} />
          产品功能体验（受限）
        </button>
      </section>
    </main>
  );
}
