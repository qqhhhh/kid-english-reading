import { ArrowDown, ArrowUp, BookOpen, FileCheck2, Plus, Trash2 } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { PdfImportSnapshot, PdfImportStructure } from "../../lib/types";

export type CourseEditorSentence = {
  id: string;
  text: string;
  itemType?: string;
  phonetic?: string;
  translation?: string;
  required?: boolean;
};

export type CourseEditorSection = {
  id: string;
  title: string;
  type?: string;
  partKind?: string;
  partLabel?: string;
  focusQuestion?: string;
  sentences: CourseEditorSentence[];
};

export type CourseEditorChapter = {
  id: string;
  title: string;
  sections?: CourseEditorSection[];
  sentences: CourseEditorSentence[];
};

type SourcePageSelection = {
  key: string;
  label: string;
  pageStart: number;
  pageEnd: number;
};

type CourseContentEditorProps = {
  chapters: CourseEditorChapter[];
  structure?: PdfImportStructure | null;
  snapshot?: PdfImportSnapshot | null;
  locatedSentenceId?: string;
  onChapterTitleChange: (chapterIndex: number, value: string) => void;
  onSectionTitleChange?: (chapterIndex: number, sectionIndex: number, value: string) => void;
  onSentenceChange: (chapterIndex: number, sectionIndex: number | null, sentenceIndex: number, value: string) => void;
  onRemoveSentence: (chapterIndex: number, sectionIndex: number | null, sentenceIndex: number) => void;
  onRemoveChapter?: (chapterIndex: number) => void;
  onAddChapter?: () => void;
  onAddSentence?: (chapterIndex: number, sectionIndex: number | null) => void;
  onReorderSentence?: (chapterIndex: number, sectionIndex: number, sentenceIndex: number, direction: "up" | "down") => void;
  onMoveSentence?: (chapterIndex: number, sectionIndex: number, sentenceIndex: number, targetSectionIndex: number) => void;
};

function getSectionDisplayTitle(section: CourseEditorSection) {
  if (section.type === "vocabulary") return "Words";
  if (section.type === "reading-time") return "Reading time";
  const partLabel = String(section.partLabel || "").trim();
  if (partLabel && section.partKind === "part") return `${partLabel} ${section.title}`;
  return section.title;
}

function GrowingTextarea({ ariaLabel, id, value, onChange }: { ariaLabel: string; id: string; value: string; onChange: (value: string) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [value]);

  return <textarea aria-label={ariaLabel} id={id} ref={textareaRef} rows={1} value={value} onChange={(event) => onChange(event.target.value)} />;
}

export function CourseContentEditor({
  chapters,
  structure,
  snapshot,
  locatedSentenceId = "",
  onChapterTitleChange,
  onSectionTitleChange,
  onSentenceChange,
  onRemoveSentence,
  onRemoveChapter,
  onAddChapter,
  onAddSentence,
  onReorderSentence,
  onMoveSentence
}: CourseContentEditorProps) {
  const [sourcePageSelection, setSourcePageSelection] = useState<SourcePageSelection | null>(null);
  const [sourcePageNumber, setSourcePageNumber] = useState(1);
  const hasSourcePreview = Boolean(structure && snapshot?.pageAssets?.length);

  function selectSourcePage(chapterIndex: number, sectionIndex?: number) {
    const chapter = chapters[chapterIndex];
    const sourceUnit = structure?.units?.[chapterIndex];
    if (!chapter || !sourceUnit) return;
    let selection: SourcePageSelection;
    if (sectionIndex === undefined) {
      selection = {
        key: `chapter-${chapter.id}`,
        label: chapter.title,
        pageStart: Math.max(1, sourceUnit.pageStart),
        pageEnd: Math.max(sourceUnit.pageStart, sourceUnit.pageEnd)
      };
    } else {
      const section = chapter.sections?.[sectionIndex];
      const sourceSection = sourceUnit.sections.filter((item) => item.blocks.some((block) => block.candidate))[sectionIndex];
      if (!section || !sourceSection) return;
      selection = {
        key: `section-${section.id}`,
        label: `${chapter.title} · ${getSectionDisplayTitle(section)}`,
        pageStart: Math.max(1, sourceSection.pageStart),
        pageEnd: Math.max(sourceSection.pageStart, sourceSection.pageEnd)
      };
    }
    setSourcePageSelection(selection);
    setSourcePageNumber(selection.pageStart);
  }

  return (
    <section className={`platform-pdf-editor-workspace course-content-editor-workspace ${hasSourcePreview ? "" : "is-single-column"}`}>
      <section className="platform-pdf-editor">
        <div className="platform-pdf-editor-title"><FileCheck2 size={18} /><span><strong>课程内容校对</strong><small>{hasSourcePreview ? "点击章节或栏目，右侧同步显示对应 PDF 原页" : "展开章节和栏目后直接校对内容"}</small></span></div>
        {chapters.map((chapter, chapterIndex) => {
          const sections = chapter.sections?.length ? chapter.sections : [{ id: `${chapter.id}-body`, title: "正文", type: "custom", sentences: chapter.sentences }];
          const itemCount = sections.reduce((sum, section) => sum + section.sentences.length, 0);
          return (
            <details className={sourcePageSelection?.key === `chapter-${chapter.id}` ? "is-source-selected" : ""} key={chapter.id}>
              <summary className={onRemoveChapter ? "has-remove" : undefined} onClick={() => selectSourcePage(chapterIndex)}>
                <span>第 {chapterIndex + 1} 章</span>
                <input
                  aria-label={`第 ${chapterIndex + 1} 章标题`}
                  className="platform-pdf-chapter-title-input"
                  value={chapter.title}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                  onChange={(event) => onChapterTitleChange(chapterIndex, event.target.value)}
                />
                <small>{itemCount} 项</small>
                {onRemoveChapter ? <button className="course-content-remove" disabled={chapters.length <= 1} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemoveChapter(chapterIndex); }} type="button" aria-label="删除章节"><Trash2 size={14} /></button> : null}
              </summary>
              {sections.map((section, renderedSectionIndex) => {
                const sectionIndex = chapter.sections?.length ? renderedSectionIndex : null;
                return (
                  <details className={`platform-pdf-section ${sourcePageSelection?.key === `section-${section.id}` ? "is-source-selected" : ""}`} key={section.id}>
                    <summary onClick={(event) => { event.stopPropagation(); if (sectionIndex !== null) selectSourcePage(chapterIndex, sectionIndex); }}><strong>{getSectionDisplayTitle(section)}</strong><small>{section.sentences.length} 项</small></summary>
                    {sectionIndex !== null && onSectionTitleChange ? <label className="platform-pdf-section-title">栏目标题<input aria-label="栏目标题" value={section.title} onChange={(event) => onSectionTitleChange(chapterIndex, sectionIndex, event.target.value)} /></label> : null}
                    {section.focusQuestion ? <p className="course-content-focus-question">{section.focusQuestion}</p> : null}
                    {section.sentences.map((sentence, sentenceIndex) => (
                      <div className={`platform-pdf-sentence ${section.type === "vocabulary" ? "is-word" : ""} ${locatedSentenceId === sentence.id ? "quality-located" : ""}`} id={`sentence-row-${sentence.id}`} key={sentence.id}>
                        <GrowingTextarea ariaLabel={`第 ${sentenceIndex + 1} 项`} id={`sentence-${sentence.id}`} value={sentence.text} onChange={(value) => onSentenceChange(chapterIndex, sectionIndex, sentenceIndex, value)} />
                        {section.type === "vocabulary" ? <span className="platform-word-meta"><b className={sentence.required === false ? "is-optional" : "is-required"}>{sentence.required === false ? "选读" : "必读"}</b>{sentence.phonetic ? <small>{sentence.phonetic}</small> : null}{sentence.translation ? <small>{sentence.translation}</small> : null}</span> : null}
                        <button aria-label="删除本项" disabled={section.sentences.length <= 1} onClick={() => onRemoveSentence(chapterIndex, sectionIndex, sentenceIndex)} type="button"><Trash2 size={15} /></button>
                        {sectionIndex !== null && (onReorderSentence || onMoveSentence) ? <div className="sentence-correction-actions course-content-row-actions">
                          {onReorderSentence ? <><button className="sentence-action-button" disabled={sentenceIndex === 0} onClick={() => onReorderSentence(chapterIndex, sectionIndex, sentenceIndex, "up")} type="button" aria-label="上移"><ArrowUp size={15} /></button><button className="sentence-action-button" disabled={sentenceIndex === section.sentences.length - 1} onClick={() => onReorderSentence(chapterIndex, sectionIndex, sentenceIndex, "down")} type="button" aria-label="下移"><ArrowDown size={15} /></button></> : null}
                          {onMoveSentence && chapter.sections && chapter.sections.length > 1 ? <select aria-label="移动到栏目" value={sectionIndex} onChange={(event) => onMoveSentence(chapterIndex, sectionIndex, sentenceIndex, Number(event.target.value))}>{chapter.sections.map((targetSection, targetIndex) => <option value={targetIndex} key={targetSection.id}>{getSectionDisplayTitle(targetSection)}</option>)}</select> : null}
                        </div> : null}
                      </div>
                    ))}
                    {onAddSentence ? <button className="course-content-add" onClick={() => onAddSentence(chapterIndex, sectionIndex)} type="button"><Plus size={15} />添加内容</button> : null}
                  </details>
                );
              })}
            </details>
          );
        })}
        {onAddChapter ? <button className="course-content-add is-chapter" onClick={onAddChapter} type="button"><Plus size={16} />添加章节</button> : null}
      </section>
      {hasSourcePreview ? <aside className="platform-pdf-source-preview" aria-live="polite">
        {sourcePageSelection ? <>
          <header><span><small>PDF 原页定位</small><strong>{sourcePageSelection.label}</strong></span><b>第 {sourcePageNumber} 页</b></header>
          {snapshot?.pageAssets.find((asset) => asset.pageNumber === sourcePageNumber) ? <img alt={`${sourcePageSelection.label} 对应 PDF 第 ${sourcePageNumber} 页`} src={snapshot.pageAssets.find((asset) => asset.pageNumber === sourcePageNumber)?.url} /> : <div className="platform-pdf-source-empty">该页暂时没有保存图片</div>}
          <footer><button disabled={sourcePageNumber <= sourcePageSelection.pageStart} onClick={() => setSourcePageNumber((page) => Math.max(sourcePageSelection.pageStart, page - 1))} type="button">← 上一页</button><span>{sourcePageSelection.pageStart === sourcePageSelection.pageEnd ? `本项位于第 ${sourcePageSelection.pageStart} 页` : `本项跨第 ${sourcePageSelection.pageStart}–${sourcePageSelection.pageEnd} 页`}</span><button disabled={sourcePageNumber >= sourcePageSelection.pageEnd} onClick={() => setSourcePageNumber((page) => Math.min(sourcePageSelection.pageEnd, page + 1))} type="button">下一页 →</button></footer>
        </> : <div className="platform-pdf-source-placeholder"><BookOpen size={30} /><strong>选择左侧内容</strong><span>点击章节或栏目后，这里会显示对应的 PDF 原页。</span></div>}
      </aside> : null}
    </section>
  );
}
