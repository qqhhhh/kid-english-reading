import { ArrowLeft, BookOpen, CheckCircle2, ClipboardList, Eye, Headphones, Home, LockKeyhole, Mic, PlayCircle, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { startFilingReviewSession } from "../../lib/api";

type ReviewView = "overview" | "parent" | "student";

const demoCourses = [
  { title: "家庭英语入门", detail: "2 章 · 12 个练习项", progress: 58 },
  { title: "日常表达练习", detail: "3 章 · 18 个练习项", progress: 33 }
];

export function FilingReviewDemoPage() {
  const [view, setView] = useState<ReviewView>("overview");
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  async function enterInteractiveReview() {
    setStarting(true);
    setStartError("");
    try {
      await startFilingReviewSession();
      window.location.assign("/practice?review=1");
    } catch {
      setStartError("暂时无法进入产品体验，请刷新页面后重试。");
      setStarting(false);
    }
  }

  useEffect(() => {
    const existing = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const meta = existing || document.createElement("meta");
    const previousContent = existing?.content;
    meta.name = "robots";
    meta.content = "noindex,nofollow,noarchive";
    if (!existing) document.head.appendChild(meta);
    return () => {
      if (existing) meta.content = previousContent || "";
      else meta.remove();
    };
  }, []);

  return (
    <main className="filing-review-page">
      <header className="filing-review-topbar">
        <button onClick={() => window.location.assign("/login")} type="button">
          <ArrowLeft size={18} />
          返回登录
        </button>
        <div>
          <ShieldCheck size={20} />
          <span>产品功能体验</span>
          <small>受限体验</small>
        </div>
      </header>

      <section className="filing-review-hero">
        <div className="filing-review-hero-mark"><BookOpen size={34} /></div>
        <div>
          <small>英语跟读家庭版</small>
          <h1>家庭自用的学生英语跟读工具</h1>
          <p>家长管理课程与练习簿，学生通过听原音、朗读和逐词反馈完成练习。体验人员可进入真实学生端交互，但不会连接或修改真实家庭数据。</p>
        </div>
        <span><Eye size={16} />公开受限体验</span>
        <button className="filing-review-enter" disabled={starting} onClick={enterInteractiveReview} type="button">
          <PlayCircle size={19} />{starting ? "正在进入…" : "进入实际跟读体验"}
        </button>
      </section>
      {startError ? <div className="filing-review-start-error" role="alert">{startError}</div> : null}

      <nav className="filing-review-tabs" aria-label="体验内容导航">
        {[
          { id: "overview" as const, label: "服务说明", Icon: Home },
          { id: "parent" as const, label: "家长端示例", Icon: ClipboardList },
          { id: "student" as const, label: "学生端示例", Icon: UserRound }
        ].map(({ id, label, Icon }) => (
          <button className={view === id ? "active" : ""} key={id} onClick={() => setView(id)} type="button">
            <Icon size={17} />{label}
          </button>
        ))}
      </nav>

      {view === "overview" ? (
        <section className="filing-review-overview">
          <article>
            <span><ClipboardList size={22} /></span>
            <h2>家长管理</h2>
            <p>创建学生、导入或编辑课程、分配练习簿，并查看练习进度与历史评价。</p>
          </article>
          <article>
            <span><Headphones size={22} /></span>
            <h2>学生练习</h2>
            <p>听参考发音后朗读，获得逐词反馈；达到要求后继续下一项。</p>
          </article>
          <article>
            <span><ShieldCheck size={22} /></span>
            <h2>受限使用</h2>
            <p>不开放匿名发布、社交、交易或公开评论；家庭注册必须使用一次性邀请 Key。</p>
          </article>
          <div className="filing-review-scope">
            <strong><LockKeyhole size={18} />体验环境说明</strong>
            <p>可进入真实学生端切换课程和句子、播放发音并完成跟读评分。系统只创建两小时有效的临时体验身份；课程、录音、成绩和进度均不持久化，不读取或修改真实家庭数据。</p>
          </div>
        </section>
      ) : null}

      {view === "parent" ? (
        <section className="filing-review-console">
          <aside>
            <strong>家长控制台</strong>
            <span className="active"><Home size={16} />概览</span>
            <span><BookOpen size={16} />课程管理</span>
            <span><ClipboardList size={16} />练习簿</span>
            <span><UserRound size={16} />学生管理</span>
          </aside>
          <div className="filing-review-console-body">
            <header><div><small>演示家庭</small><h2>学习概览</h2></div><em>所有操作已禁用</em></header>
            <div className="filing-review-metrics">
              <span><small>学生</small><b>1</b></span>
              <span><small>练习课程</small><b>2</b></span>
              <span><small>完成练习</small><b>9</b></span>
            </div>
            <section className="filing-review-course-panel">
              <h3>当前练习簿</h3>
              {demoCourses.map((course, index) => (
                <article key={course.title}>
                  <i>{index + 1}</i>
                  <div><strong>{course.title}</strong><small>{course.detail}</small></div>
                  <span><b>{course.progress}%</b><i><em style={{ width: `${course.progress}%` }} /></i></span>
                  <button disabled type="button">查看</button>
                </article>
              ))}
            </section>
          </div>
        </section>
      ) : null}

      {view === "student" ? (
        <section className="filing-review-student">
          <aside>
            <small>我的练习簿</small>
            <strong>家庭英语入门</strong>
            <span className="done"><CheckCircle2 size={16} />Good morning!</span>
            <span className="active"><Sparkles size={16} />I can help my family.</span>
            <span><LockKeyhole size={15} />How are you today?</span>
          </aside>
          <article>
            <header><span>日常表达 · 第 2 项</span><em>进入实际体验后可使用麦克风</em></header>
            <div className="filing-review-sentence">
              <small>跟读句子</small>
              <h2>I can help my family.</h2>
              <div>
                <button disabled type="button"><Headphones size={19} />听原音</button>
                <button disabled className="record" type="button"><Mic size={25} />开始</button>
                <button disabled type="button">下一项</button>
              </div>
            </div>
            <footer>
              <strong>示例反馈</strong>
              <span><b>清晰单词</b> 5 / 5</span>
              <span><b>有效流利度</b> 86%</span>
            </footer>
          </article>
        </section>
      ) : null}

      <footer className="filing-review-footer">
        <ShieldCheck size={16} />产品受限体验 · 不保存录音或成绩 · 无公开注册 · 无交易功能
      </footer>
    </main>
  );
}
