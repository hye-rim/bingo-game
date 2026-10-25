'use strict';

// 숫자 빙고: 규칙만 모아 둔 파일 (그리기·입력 없음). 브라우저·서버·테스트(Node)가 같이 쓴다.
//
// - 5x5 칸에 1~25 를 한 번씩 적은 내 판을 만든다 (섞거나 직접 채운다). 상대 판은 끝날 때까지 안 보인다
// - 번갈아 1~25 중 아직 안 나온 숫자 하나를 부른다. 부른 숫자는 두 사람의 판에서 모두 지워진다
// - 가로 5·세로 5·대각선 2, 모두 12줄 중 한 줄이 다 지워지면 1줄. 먼저 5줄을 만들면 이긴다
// - 한 번 부른 숫자로 둘 다 5줄이 되면 부른 사람이 이긴다 (무승부는 없다)
const LOGIC_BINGO = (() => {
const SIZE = 5, N = SIZE * SIZE, TARGET = 5;
const LINES = (() => {
  const out = [];
  for (let r = 0; r < SIZE; r++) out.push(Array.from({ length: SIZE }, (_, c) => r * SIZE + c));
  for (let c = 0; c < SIZE; c++) out.push(Array.from({ length: SIZE }, (_, r) => r * SIZE + c));
  out.push(Array.from({ length: SIZE }, (_, i) => i * SIZE + i));
  out.push(Array.from({ length: SIZE }, (_, i) => i * SIZE + (SIZE - 1 - i)));
  return out;
})();

function rng(seed) {                                   // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1~25 를 섞은 판 (칸 번호 0~24 → 적힌 숫자)
function randomBoard(rand = Math.random) {
  const b = Array.from({ length: N }, (_, i) => i + 1);
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
// 1~25 가 한 번씩 적힌 판인가
const validBoard = (b) => Array.isArray(b) && b.length === N && b.every((v) => Number.isInteger(v) && v >= 1 && v <= N) && new Set(b).size === N;

// 지워진 칸(marks[i] 가 true)으로 완성된 줄 번호들
const doneLines = (marks) => LINES.map((ln, i) => (ln.every((c) => marks[c]) ? i : -1)).filter((i) => i >= 0);

// 판 두 개로 시작. first: 먼저 부르는 사람(0·1)
function newGame(opts = {}) {
  const seed = opts.seed == null ? (Math.random() * 2 ** 31) | 0 : opts.seed;
  const rand = rng(seed);
  const boards = opts.boards || [randomBoard(rand), randomBoard(rand)];
  return {
    seed, rand, boards: boards.map((b) => b.slice()), marks: [new Array(N).fill(false), new Array(N).fill(false)],
    called: [], turn: opts.first === 1 ? 1 : 0, winner: -1, lines: [0, 0], callers: [],
  };
}

const uncalled = (st) => { const seen = new Set(st.called); const out = []; for (let n = 1; n <= N; n++) if (!seen.has(n)) out.push(n); return out; };

// who 가 num 을 부른다. 규칙에 어긋나면 null, 아니면 { num, lines, winner, newLines }
function call(st, who, num) {
  if (st.winner >= 0 || who !== st.turn) return null;
  if (!Number.isInteger(num) || num < 1 || num > N || st.called.includes(num)) return null;
  const before = st.lines.slice();
  st.called.push(num); st.callers.push(who);
  for (const p of [0, 1]) { st.marks[p][st.boards[p].indexOf(num)] = true; st.lines[p] = doneLines(st.marks[p]).length; }
  if (st.lines[who] >= TARGET) st.winner = who;
  else if (st.lines[1 - who] >= TARGET) st.winner = 1 - who;
  else st.turn = 1 - who;
  return { num, lines: st.lines.slice(), winner: st.winner, newLines: [st.lines[0] - before[0], st.lines[1] - before[1]] };
}

// 컴퓨터가 고를 숫자. level: 'easy' 는 아무거나, 'hard' 는 내 판에서 줄이 가장 빨리 완성될 칸의 숫자를 고른다
// (상대 판은 모르니 내 판만 본다)
function aiPick(st, who, level, rand = st.rand) {
  const cand = uncalled(st);
  if (!cand.length) return null;
  if (level !== 'hard') return cand[Math.floor(rand() * cand.length)];
  const board = st.boards[who], marks = st.marks[who];
  const W = [0, 1, 3, 9, 27, 81];                      // 한 줄에 이미 지워진 칸이 많을수록 그 줄을 완성하는 숫자가 값지다
  let best = [], bs = -1;
  for (const n of cand) {
    const idx = board.indexOf(n);
    let s = 0;
    for (const ln of LINES) if (ln.includes(idx)) s += W[ln.filter((c) => marks[c]).length + 1];
    if (s > bs) { bs = s; best = [n]; } else if (s === bs) best.push(n);
  }
  return best[Math.floor(rand() * best.length)];
}

return { SIZE, N, TARGET, LINES, rng, randomBoard, validBoard, doneLines, newGame, uncalled, call, aiPick };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_BINGO;
