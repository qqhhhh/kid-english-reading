import { ArrowLeft, Eraser, Lightbulb, Pencil, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type SudokuSize = 4 | 6 | 9;
type Difficulty = "easy" | "medium" | "hard";
type Snapshot = { values: number[]; notes: number[][] };

const difficultyLabels: Record<Difficulty, string> = { easy: "简单", medium: "普通", hard: "困难" };
const clueRatios: Record<Difficulty, number> = { easy: .58, medium: .45, hard: .36 };

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function boxShape(size: SudokuSize) { return size === 4 ? [2, 2] as const : size === 6 ? [2, 3] as const : [3, 3] as const; }

function makeSolution(size: SudokuSize) {
  const [boxRows, boxCols] = boxShape(size);
  const rows = shuffled(Array.from({ length: size / boxRows }, (_, band) => band)).flatMap((band) => shuffled(Array.from({ length: boxRows }, (_, row) => band * boxRows + row)));
  const cols = shuffled(Array.from({ length: size / boxCols }, (_, stack) => stack)).flatMap((stack) => shuffled(Array.from({ length: boxCols }, (_, col) => stack * boxCols + col)));
  const numbers = shuffled(Array.from({ length: size }, (_, index) => index + 1));
  return rows.flatMap((row) => cols.map((col) => numbers[(boxCols * (row % boxRows) + Math.floor(row / boxRows) + col) % size]));
}

function candidates(board: number[], cell: number, size: SudokuSize) {
  const [boxRows, boxCols] = boxShape(size);
  const row = Math.floor(cell / size);
  const col = cell % size;
  const used = new Set<number>();
  for (let index = 0; index < size; index += 1) { used.add(board[row * size + index]); used.add(board[index * size + col]); }
  const startRow = Math.floor(row / boxRows) * boxRows;
  const startCol = Math.floor(col / boxCols) * boxCols;
  for (let y = 0; y < boxRows; y += 1) for (let x = 0; x < boxCols; x += 1) used.add(board[(startRow + y) * size + startCol + x]);
  return Array.from({ length: size }, (_, index) => index + 1).filter((value) => !used.has(value));
}

function countSolutions(board: number[], size: SudokuSize, limit = 2): number {
  let target = -1;
  let options: number[] = [];
  for (let cell = 0; cell < board.length; cell += 1) {
    if (board[cell]) continue;
    const next = candidates(board, cell, size);
    if (next.length === 0) return 0;
    if (target < 0 || next.length < options.length) { target = cell; options = next; }
  }
  if (target < 0) return 1;
  let total = 0;
  for (const value of options) {
    board[target] = value;
    total += countSolutions(board, size, limit - total);
    board[target] = 0;
    if (total >= limit) break;
  }
  return total;
}

function makePuzzle(size: SudokuSize, difficulty: Difficulty) {
  const solution = makeSolution(size);
  const puzzle = [...solution];
  const targetClues = Math.ceil(size * size * clueRatios[difficulty]);
  for (const cell of shuffled(Array.from({ length: puzzle.length }, (_, index) => index))) {
    if (puzzle.filter(Boolean).length <= targetClues) break;
    const value = puzzle[cell];
    puzzle[cell] = 0;
    if (countSolutions([...puzzle], size) !== 1) puzzle[cell] = value;
  }
  return { puzzle, solution };
}

function formatTime(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }

export function SudokuPage() {
  const [size, setSize] = useState<SudokuSize>(9);
  const [difficulty, setDifficulty] = useState<Difficulty>("easy");
  const initial = useMemo(() => makePuzzle(size, difficulty), [size, difficulty]);
  const [puzzle, setPuzzle] = useState(initial.puzzle);
  const [solution, setSolution] = useState(initial.solution);
  const [values, setValues] = useState(initial.puzzle);
  const [notes, setNotes] = useState<number[][]>(() => initial.puzzle.map(() => []));
  const [selected, setSelected] = useState(-1);
  const [noteMode, setNoteMode] = useState(false);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [seconds, setSeconds] = useState(0);
  const [loadedStorageKey, setLoadedStorageKey] = useState("");
  const completed = values.every((value, index) => value === solution[index]);
  const storageKey = `kid-reading-sudoku-${size}-${difficulty}`;
  const [boxRows, boxCols] = boxShape(size);

  function startNewGame() {
    const next = makePuzzle(size, difficulty);
    setPuzzle(next.puzzle); setSolution(next.solution); setValues(next.puzzle); setNotes(next.puzzle.map(() => [])); setSelected(-1); setHistory([]); setSeconds(0);
    localStorage.removeItem(storageKey);
  }

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const state = JSON.parse(saved);
        if (state.puzzle?.length === size * size && state.solution?.length === size * size) {
          setPuzzle(state.puzzle); setSolution(state.solution); setValues(state.values); setNotes(state.notes); setSeconds(Number(state.seconds || 0)); setHistory([]); setSelected(-1); setLoadedStorageKey(storageKey); return;
        }
      } catch { /* Start a fresh puzzle. */ }
    }
    const next = makePuzzle(size, difficulty);
    setPuzzle(next.puzzle); setSolution(next.solution); setValues(next.puzzle); setNotes(next.puzzle.map(() => [])); setSeconds(0); setHistory([]); setSelected(-1); setLoadedStorageKey(storageKey);
  }, [difficulty, size, storageKey]);

  useEffect(() => {
    if (completed) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [completed]);

  useEffect(() => {
    if (loadedStorageKey !== storageKey || values.length !== size * size) return;
    localStorage.setItem(storageKey, JSON.stringify({ puzzle, solution, values, notes, seconds }));
  }, [loadedStorageKey, notes, puzzle, seconds, size, solution, storageKey, values]);

  function remember() { setHistory((items) => [...items.slice(-39), { values: [...values], notes: notes.map((item) => [...item]) }]); }
  function enter(value: number) {
    if (selected < 0 || puzzle[selected]) return;
    remember();
    if (noteMode) {
      setNotes((items) => items.map((item, index) => index === selected ? item.includes(value) ? item.filter((number) => number !== value) : [...item, value].sort((a, b) => a - b) : item));
      return;
    }
    setValues((items) => items.map((item, index) => index === selected ? value : item));
    setNotes((items) => items.map((item, index) => index === selected ? [] : item));
  }
  function erase() { if (selected < 0 || puzzle[selected]) return; remember(); setValues((items) => items.map((item, index) => index === selected ? 0 : item)); setNotes((items) => items.map((item, index) => index === selected ? [] : item)); }
  function undo() { const last = history.at(-1); if (!last) return; setValues(last.values); setNotes(last.notes); setHistory((items) => items.slice(0, -1)); }
  function hint() { if (selected < 0 || puzzle[selected]) return; remember(); enterSolution(selected); }
  function enterSolution(cell: number) { setValues((items) => items.map((item, index) => index === cell ? solution[cell] : item)); setNotes((items) => items.map((item, index) => index === cell ? [] : item)); }

  const selectedValue = selected >= 0 ? values[selected] : 0;
  const selectedRow = selected >= 0 ? Math.floor(selected / size) : -1;
  const selectedCol = selected >= 0 ? selected % size : -1;
  const selectedBoxRow = selectedRow >= 0 ? Math.floor(selectedRow / boxRows) : -1;
  const selectedBoxCol = selectedCol >= 0 ? Math.floor(selectedCol / boxCols) : -1;

  return <main className="sudoku-page">
    <header className="sudoku-topbar"><button onClick={() => window.location.assign("/practice")} type="button"><ArrowLeft />返回学习</button><div><Sparkles /><span><strong>数独乐园</strong><small>安静思考，每一步都有答案</small></span></div><strong className="sudoku-timer">{formatTime(seconds)}</strong></header>
    <section className="sudoku-shell">
      <aside className="sudoku-settings"><small>PUZZLE SETTINGS</small><h1>九宫数独</h1><p>选择阶数和难度，数字在每行、每列和每个宫内都不能重复。</p><label>阶数<select onChange={(event) => setSize(Number(event.target.value) as SudokuSize)} value={size}><option value={4}>4 × 4</option><option value={6}>6 × 6</option><option value={9}>9 × 9</option></select></label><label>难度<select onChange={(event) => setDifficulty(event.target.value as Difficulty)} value={difficulty}><option value="easy">简单</option><option value="medium">普通</option><option value="hard">困难</option></select></label><button className="sudoku-new" onClick={startNewGame} type="button"><RotateCcw />换一题</button><div className="sudoku-legend"><span><i className="given" />题目数字</span><span><i className="answer" />填写数字</span><span><i className="wrong" />需要检查</span></div></aside>
      <section className="sudoku-game"><div className="sudoku-status"><span>{size}阶 · {difficultyLabels[difficulty]}</span><strong>{completed ? "完成啦！太棒了 🎉" : "选择空格，再填写数字"}</strong></div><div className={`sudoku-board size-${size}`} style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}>{values.map((value, cell) => { const row = Math.floor(cell / size); const col = cell % size; const related = selected >= 0 && (row === selectedRow || col === selectedCol || (Math.floor(row / boxRows) === selectedBoxRow && Math.floor(col / boxCols) === selectedBoxCol)); const same = Boolean(selectedValue && value === selectedValue); const wrong = Boolean(value && !puzzle[cell] && value !== solution[cell]); return <button className={`${puzzle[cell] ? "given" : ""} ${cell === selected ? "selected" : ""} ${related ? "related" : ""} ${same ? "same" : ""} ${wrong ? "wrong" : ""}`} key={cell} onClick={() => setSelected(cell)} style={{ borderRightWidth: (col + 1) % boxCols === 0 && col < size - 1 ? 3 : 1, borderBottomWidth: (row + 1) % boxRows === 0 && row < size - 1 ? 3 : 1 }} type="button">{value || <span className="sudoku-notes">{Array.from({ length: size }, (_, index) => <i key={index}>{notes[cell]?.includes(index + 1) ? index + 1 : ""}</i>)}</span>}</button>; })}</div><div className="sudoku-number-pad">{Array.from({ length: size }, (_, index) => <button className={selectedValue === index + 1 ? "active" : ""} key={index} onClick={() => enter(index + 1)} type="button">{index + 1}</button>)}</div><div className="sudoku-actions"><button className={noteMode ? "active" : ""} onClick={() => setNoteMode((value) => !value)} type="button"><Pencil />笔记</button><button disabled={!history.length} onClick={undo} type="button"><Undo2 />撤销</button><button onClick={erase} type="button"><Eraser />擦除</button><button onClick={hint} type="button"><Lightbulb />提示</button></div></section>
    </section>
  </main>;
}
