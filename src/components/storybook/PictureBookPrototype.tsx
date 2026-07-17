import { ArrowLeft, BookOpen, Check, ChevronLeft, ChevronRight, Mic, Pause, Play, Sparkles, Volume2, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { findPictureBook, pictureBooks } from "../../data/pictureBooks";
import { fetchChildren, fetchImportedStorybook, fetchStorybookAttempts, getStorybookTtsUrl, submitRejectedAttemptDiagnostic, submitStorybookAttempt } from "../../lib/api";
import type { Attempt, ChildProfile, Sentence } from "../../lib/types";
import type { PictureBook } from "../../data/pictureBooks";
import { RecordingQualityError, WavRecorder } from "../../lib/wavRecorder";
import { getPracticeIssue, type PracticeIssue } from "../../lib/practiceErrors";
import { PracticeIssueNotice } from "../practice/PracticeIssueNotice";

export function PictureBookPrototype() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("book") || pictureBooks[0]?.slug;
  const bookId = params.get("bookId") || "";
  const requestedChildId = params.get("childId") || "";
  const [importedBook, setImportedBook] = useState<PictureBook | null>(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    if (!bookId) return;
    void fetchImportedStorybook(bookId).then(setImportedBook).catch(() => setLoadError("这本绘本暂时无法打开，请返回广场重试。"));
  }, [bookId]);
  if (bookId && !importedBook) return <main className="picture-book-prototype picture-book-loading"><BookOpen />{loadError || "正在打开本地绘本…"}</main>;
  return <PictureBookReader book={importedBook || findPictureBook(slug) || pictureBooks[0]} requestedChildId={requestedChildId} />;
}

function PictureBookReader({ book, requestedChildId }: { book: PictureBook; requestedChildId: string }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [lineIndex, setLineIndex] = useState(0);
  const [mode, setMode] = useState<"explore" | "repeat">("repeat");
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [recordingError, setRecordingError] = useState<string | PracticeIssue>("");
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [officialAudioPlaying, setOfficialAudioPlaying] = useState(false);
  const officialAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const pagePlaybackRun = useRef(0);
  const recorderRef = useRef<WavRecorder | null>(null);
  const advanceTimerRef = useRef<number | null>(null);
  const dragStart = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const page = book.pages[pageIndex];
  const officialAudio = page.officialAudio || book.officialAudio;
  const activeSentence = page.sentences[lineIndex];
  const activeAttempt = activeSentence ? attempts.filter((attempt) => attempt.sentenceId === activeSentence.id).sort((a, b) => Number(b.passed) - Number(a.passed) || Number(b.result?.SuggestedScore || 0) - Number(a.result?.SuggestedScore || 0))[0] : undefined;
  const activeChild = children.find((child) => child.id === requestedChildId) || children[0];
  const sentenceCount = book.pages.reduce((count, item) => count + item.sentences.length, 0);
  const passedSentenceIds = new Set(attempts.filter((attempt) => attempt.passed).map((attempt) => attempt.sentenceId));
  const completedSentenceCount = book.pages.reduce((count, item) => count + item.sentences.filter((sentence) => passedSentenceIds.has(sentence.id)).length, 0);
  const bookCompleted = sentenceCount > 0 && completedSentenceCount === sentenceCount;

  useEffect(() => {
    let active = true;
    void fetchChildren().then(async (items) => {
      if (!active) return;
      setChildren(items);
      const selected = items.find((child) => child.id === requestedChildId) || items[0];
      if (selected) setAttempts(await fetchStorybookAttempts(book.id, selected.id));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [book.id, requestedChildId]);

  useEffect(() => () => {
    officialAudioRef.current?.pause();
    officialAudioRef.current = null;
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    pagePlaybackRun.current += 1;
    if (advanceTimerRef.current !== null) window.clearTimeout(advanceTimerRef.current);
    void recorderRef.current?.cancel();
    recorderRef.current = null;
  }, []);

  function stopTtsPlayback() {
    pagePlaybackRun.current += 1;
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    setPlaying(false);
  }
  function cancelPendingAdvance() { if (advanceTimerRef.current !== null) { window.clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; } }
  function goToPage(next: number) { cancelPendingAdvance(); stopTtsPlayback(); setPageIndex(Math.max(0, Math.min(book.pages.length - 1, next))); setLineIndex(0); setRecording(false); }
  function playTtsText(text: string) {
    return new Promise<void>((resolve, reject) => {
      ttsAudioRef.current?.pause();
      const audio = new Audio(getStorybookTtsUrl(text));
      ttsAudioRef.current = audio;
      audio.addEventListener("ended", () => { if (ttsAudioRef.current === audio) ttsAudioRef.current = null; resolve(); }, { once: true });
      audio.addEventListener("error", () => { if (ttsAudioRef.current === audio) ttsAudioRef.current = null; reject(new Error("绘本语音播放失败")); }, { once: true });
      audio.play().catch(reject);
    });
  }
  async function playSentence(index: number) {
    cancelPendingAdvance();
    if (playing && lineIndex === index) { stopTtsPlayback(); return; }
    const sentence = page.sentences[index];
    if (!sentence) return;
    const run = ++pagePlaybackRun.current;
    setRecordingError("");
    setLineIndex(index);
    setRecording(false);
    setPlaying(true);
    try { await playTtsText(sentence.text); }
    catch (error) { setRecordingError(getPracticeIssue(error, "tts", "zh")); }
    if (pagePlaybackRun.current === run) setPlaying(false);
  }
  async function playWholePage() {
    if (playing) { stopTtsPlayback(); return; }
    if (officialAudio) { await toggleOfficialAudio(); return; }
    const run = ++pagePlaybackRun.current;
    setRecordingError("");
    setRecording(false);
    setPlaying(true);
    for (let index = 0; index < page.sentences.length; index += 1) {
      if (pagePlaybackRun.current !== run) return;
      setLineIndex(index);
      try { await playTtsText(page.sentences[index].text); }
      catch (error) { setRecordingError(getPracticeIssue(error, "tts", "zh")); break; }
    }
    if (pagePlaybackRun.current === run) setPlaying(false);
  }
  async function toggleRecording() {
    if (scoring) return;
    setRecordingError("");
    if (!recording) {
      if (!activeChild || !activeSentence) { setRecordingError("请先登录学生账号再开始跟读。"); return; }
      stopTtsPlayback();
      const recorder = new WavRecorder();
      recorderRef.current = recorder;
      try { await recorder.start(); setRecording(true); }
      catch (error) {
        await recorder.cancel();
        recorderRef.current = null;
        setRecordingError(getPracticeIssue(error, "microphone", "zh"));
      }
      return;
    }
    const recorder = recorderRef.current;
    if (!recorder || !activeChild || !activeSentence) return;
    setRecording(false);
    setScoring(true);
    try {
      const recorded = await recorder.stop();
      const sentence: Sentence = { id: activeSentence.id, text: activeSentence.text, minScore: 75 };
      const attempt = await submitStorybookAttempt({ bookId: book.id, pageId: page.id, sentence, recording: recorded, childId: activeChild.id });
      setAttempts((current) => [attempt, ...current]);
      if (attempt.passed) {
        advanceTimerRef.current = window.setTimeout(() => advanceAfter(pageIndex, lineIndex), 900);
      }
    } catch (error) {
      if (error instanceof RecordingQualityError && error.recording) {
        void submitRejectedAttemptDiagnostic({
          childId: activeChild.id,
          sentence: { id: activeSentence.id, text: activeSentence.text, minScore: 75 },
          recording: error.recording,
          rejectionCode: error.code,
          sourceType: "storybook",
          contentId: book.id,
          contentTitle: book.title,
          storybookPageId: page.id
        }).catch((diagnosticError) => {
          console.warn("Unable to save rejected storybook recording diagnostic.", diagnosticError);
        });
      }
      setRecordingError(getPracticeIssue(error, error instanceof RecordingQualityError ? "recording" : "scoring", "zh"));
    } finally {
      await recorder.cancel();
      recorderRef.current = null;
      setScoring(false);
    }
  }
  function advanceAfter(currentPageIndex: number, currentLineIndex: number) {
    const currentPage = book.pages[currentPageIndex];
    if (currentLineIndex + 1 < currentPage.sentences.length) {
      setLineIndex(currentLineIndex + 1);
      setRecordingError("");
      return;
    }
    for (let nextPageIndex = currentPageIndex + 1; nextPageIndex < book.pages.length; nextPageIndex += 1) {
      if (book.pages[nextPageIndex].sentences.length > 0) {
        goToPage(nextPageIndex);
        return;
      }
    }
  }
  async function toggleOfficialAudio() {
    if (!officialAudio) return;
    setRecordingError("");
    const current = officialAudioRef.current;
    if (current && current.src === new URL(officialAudio.url, window.location.href).href) {
      if (current.paused) {
        try {
          await current.play();
          setOfficialAudioPlaying(true);
        } catch (error) {
          setOfficialAudioPlaying(false);
          setRecordingError(getPracticeIssue(error, "tts", "zh"));
        }
      } else {
        current.pause();
        setOfficialAudioPlaying(false);
      }
      return;
    }
    current?.pause();
    const audio = new Audio(officialAudio.url);
    officialAudioRef.current = audio;
    audio.addEventListener("ended", () => setOfficialAudioPlaying(false), { once: true });
    audio.addEventListener("error", () => {
      setOfficialAudioPlaying(false);
      setRecordingError(getPracticeIssue({ code: "TTS_FAILED" }, "tts", "zh"));
    }, { once: true });
    try {
      await audio.play();
      setOfficialAudioPlaying(true);
    } catch (error) {
      setOfficialAudioPlaying(false);
      setRecordingError(getPracticeIssue(error, "tts", "zh"));
    }
  }
  function startSwipe(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragStart.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.classList.add("dragging");
  }
  function cancelSwipe(event: PointerEvent<HTMLDivElement>) {
    dragStart.current = null;
    event.currentTarget.classList.remove("dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function finishSwipe(event: PointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    cancelSwipe(event);
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 52 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
    if (deltaX < 0 && pageIndex < book.pages.length - 1) goToPage(pageIndex + 1);
    if (deltaX > 0 && pageIndex > 0) goToPage(pageIndex - 1);
  }
  return <main className="picture-book-prototype official-picture-book">
    <header className="picture-book-topbar"><button onClick={() => window.location.assign(`/picture-books${requestedChildId ? `?childId=${encodeURIComponent(requestedChildId)}` : ""}`)} type="button"><ArrowLeft size={19} /><span>返回绘本广场</span></button><div className="picture-book-title"><BookOpen size={20} /><div><strong>{book.title}</strong><small>{book.source.name} · {book.license.code}</small></div></div><div className="picture-book-page-count"><span>{pageIndex + 1}</span> / {book.pages.length}</div></header>
    <section className="picture-book-stage">
      <div className="picture-book-canvas official-book-page" onPointerCancel={cancelSwipe} onPointerDown={startSwipe} onPointerUp={finishSwipe}><img alt={`${book.title} 第${pageIndex + 1}页`} draggable={false} src={page.imageUrl} />{officialAudio ? <button aria-label={officialAudioPlaying ? "暂停官方原音" : "播放官方原音"} className={`picture-book-official-audio ${officialAudioPlaying ? "playing" : ""}`} onClick={(event) => { event.stopPropagation(); void toggleOfficialAudio(); }} onPointerDown={(event) => event.stopPropagation()} type="button">{officialAudioPlaying ? <Pause size={18} /> : <Volume2 size={18} />}<span>{officialAudioPlaying ? "暂停原音" : officialAudio.label || "原音读"}</span></button> : null}<div className="picture-book-dots">{book.pages.map((_, index) => <button className={index === pageIndex ? "active" : ""} key={index} onClick={() => goToPage(index)} onPointerDown={(event) => event.stopPropagation()} type="button" aria-label={`第${index + 1}页`} />)}</div></div>
      <aside className="picture-book-reader">
        <div className="picture-book-mode-switch"><button className={mode === "explore" ? "active" : ""} onClick={() => setMode("explore")} type="button"><Sparkles size={16} />亲子阅读</button><button className={mode === "repeat" ? "active" : ""} onClick={() => setMode("repeat")} type="button"><Mic size={16} />逐句跟读</button></div>
        <div className="picture-book-progress"><span style={{ width: `${sentenceCount ? (completedSentenceCount / sentenceCount) * 100 : 0}%` }} /></div>
        <div className={`picture-book-progress-summary ${bookCompleted ? "completed" : ""}`}><strong>{bookCompleted ? "整本跟读完成！" : `已通过 ${completedSentenceCount} / ${sentenceCount} 句`}</strong><span>{bookCompleted ? "太棒了，继续保持阅读习惯～" : "读准一句，就点亮一颗故事星"}</span></div>
        <div className="picture-book-copy"><small>第 {pageIndex + 1} 页 · {page.sentences.length ? mode === "repeat" ? "选择一句开始跟读" : "点击句子听读音" : page.kind === "cover" ? "绘本封面" : "观察画面，感受故事停顿"}</small>{page.sentences.map((sentence, index) => <button className={`${lineIndex === index ? "active" : ""} ${passedSentenceIds.has(sentence.id) ? "done" : ""}`} key={sentence.id} onClick={() => void playSentence(index)} type="button"><span>{passedSentenceIds.has(sentence.id) ? <Check size={16} /> : index + 1}</span><strong>{sentence.text}</strong>{playing && lineIndex === index ? <Pause size={17} /> : <Volume2 size={17} />}</button>)}</div>
        {activeSentence ? <div className={`picture-book-action-card ${recording ? "recording" : ""}`}><div><small>{recording ? "正在听你读…" : scoring ? "正在认真评分…" : playing ? "正在播放读音" : activeAttempt ? `历史最高 ${Math.round(Number(activeAttempt.result?.SuggestedScore || 0))} 分${activeAttempt.passed ? " · 已通过" : " · 再试一次"}` : "准备好了吗？"}</small><strong>{activeSentence.text}</strong></div><div className="picture-book-actions"><button className="listen" disabled={recording || scoring} onClick={() => void playSentence(lineIndex)} type="button">{playing ? <Pause /> : <Volume2 />}<span>{playing ? "暂停" : "听读音"}</span></button>{mode === "repeat" ? <button className="record" disabled={scoring} onClick={() => void toggleRecording()} type="button">{recording ? <X /> : <Mic />}<span>{scoring ? "评分中" : recording ? "完成" : "跟读"}</span></button> : <button className="record" onClick={() => void playWholePage()} type="button">{playing ? <Pause /> : <Play />}<span>{playing ? "暂停" : officialAudio ? "原音读本页" : "听本页"}</span></button>}</div>{recordingError ? (typeof recordingError === "string" ? <p className="picture-book-recording-error">{recordingError}</p> : <PracticeIssueNotice issue={recordingError} className="picture-book-recording-error" />) : <p>{officialAudio ? "本页优先使用资源提供的官方原音；逐句听读使用英语合成语音。" : "当前绘本没有官方英语原音，逐句与整页听读使用英语合成语音。"}</p>}</div> : <div className="picture-book-page-pause"><BookOpen /><strong>{page.kind === "cover" ? "翻页开始故事" : "这一页没有文字"}</strong><p>{page.kind === "cover" ? book.summary : "让学生先观察画面，再进入下一页。"}</p></div>}
        <div className="picture-book-attribution"><strong>作品署名</strong><p>{book.license.attribution}</p>{book.source.url ? <a href={book.source.url} rel="noreferrer" target="_blank">查看官方来源</a> : <span>{book.source.name}</span>}<span> · </span>{book.license.url ? <a href={book.license.url} rel="noreferrer" target="_blank">{book.license.code}</a> : <span>{book.license.code}</span>}</div>
      </aside>
    </section>
    <nav className="picture-book-navigation"><button disabled={pageIndex === 0} onClick={() => goToPage(pageIndex - 1)} type="button"><ChevronLeft />上一页</button><span>左右滑动翻页 · 第 {pageIndex + 1} / {book.pages.length} 页</span><button disabled={pageIndex === book.pages.length - 1} onClick={() => goToPage(pageIndex + 1)} type="button">下一页<ChevronRight /></button></nav>
  </main>;
}
