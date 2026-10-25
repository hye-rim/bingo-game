'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (arcade/public/tutorial.js 가 듣는다. 튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 숫자 빙고: 화면·입력·소리·온라인. 규칙과 컴퓨터는 logic.js (LOGIC_BINGO), 방·매칭은 server.js
(() => {
const L = LOGIC_BINGO;
const { N, TARGET } = L;
const $ = (id) => document.getElementById(id);
const T = { cpu: 900, over: 1000 };                        // 시간(ms). 시험용으로 줄일 수 있다

// ---------- 저장소 ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
let wins = Number(store.get('bingoWins')) || 0;
const ONLINE_KEY = 'bingoOnline', SESSION_KEY = 'bingoSession';
const loadJson = (k) => { try { return JSON.parse(store.get(k)) || {}; } catch (_) { return {}; } };
function loadSession() { try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (_) { return null; } }
function saveSession(s) { try { s ? sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)) : sessionStorage.removeItem(SESSION_KEY); } catch (_) {} }
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const myName = () => store.get('bingoName') || '';

// ---------- 소리 ----------
let audio = null;
let muted = store.get('bingoMuted') === '1';
function tone(freq, dur, type = 'sine', vol = 0.09, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + dur);
  } catch (_) {}
}
const seq = (notes, step, type = 'triangle', vol = 0.09) => notes.forEach((f, i) => setTimeout(() => tone(f, step * 0.0009, type, vol), i * step));
const sfx = {
  place: () => tone(560, 0.05, 'triangle', 0.06),
  shuffle: () => [0, 60, 120].forEach((d) => setTimeout(() => tone(300 + Math.random() * 200, 0.05, 'square', 0.04), d)),
  mine: () => tone(520, 0.1, 'triangle', 0.09, 120),
  theirs: () => tone(400, 0.1, 'sine', 0.08, -60),
  line: () => seq([659, 784, 1047], 80, 'triangle', 0.1),
  found: () => seq([392, 523], 90, 'triangle', 0.08),
  win: () => seq([523, 659, 784, 1047], 110, 'triangle', 0.1),
  lose: () => seq([392, 330, 262, 196], 150, 'sawtooth', 0.06),
};
function toggleMute() { muted = !muted; store.set('bingoMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

// ---------- 상태 ----------
let mode = 'easy';                // 'easy' · 'hard' (컴퓨터) · 'online'
let phase = 'title';              // title · setup · play · over
let st = null;                    // 컴퓨터 대전 판 (L.newGame) — 나는 0번, 컴퓨터는 1번
let draft = new Array(N).fill(0), manual = false, nextNum = 1, readySent = false;   // 판 만드는 중
let room = null, waitingNet = false, netDown = false, turnEnd = 0, recorded = '';
let shownCalls = 0, lastCall = 0, myLinesShown = 0, oppLinesShown = 0;
let cpuTimer = 0, overTimer = 0;
const online = () => mode === 'online';
const full = (b) => b.every((v) => v > 0);

// 화면에 그릴 모양으로: 나는 항상 0, 상대는 1
function model() {
  if (online()) {
    if (!room) return null;
    const me = room.you, r = room;
    const setup = r.state === 'setup' || r.state === 'waiting';
    return {
      phase: setup ? 'setup' : r.state === 'playing' ? 'play' : 'over',
      board: setup ? (readySent && r.myBoard ? r.myBoard : draft) : (r.myBoard || draft),
      called: r.called, callers: r.callers.map((c) => (c === me ? 0 : 1)),
      lines: [r.lines[me], r.lines[1 - me]],
      myTurn: r.state === 'playing' && r.turn === me && !netDown,
      turnIs: r.state === 'playing' ? (r.turn === me ? 0 : 1) : -1,
      ready: readySent, oppReady: !!(r.players.find((p) => p.color !== me) || {}).ready,
      winner: r.state === 'over' ? (r.winner === me ? 0 : 1) : -1,
      oppBoard: r.oppBoard,
    };
  }
  if (phase === 'setup') return { phase: 'setup', board: draft, called: [], callers: [], lines: [0, 0], myTurn: false, turnIs: -1, ready: false, oppReady: false, winner: -1, oppBoard: null };
  if (!st) return null;
  return {
    phase: st.winner >= 0 ? 'over' : 'play', board: st.boards[0], called: st.called, callers: st.callers,
    lines: st.lines.slice(), myTurn: st.winner < 0 && st.turn === 0, turnIs: st.winner < 0 ? st.turn : -1,
    ready: true, oppReady: true, winner: st.winner, oppBoard: st.boards[1],
  };
}
const opponent = () => (room ? room.players.find((p) => p.color !== room.you) : null);
const oppName = () => (online() ? ((opponent() || {}).name || '상대') : '컴퓨터');

// ---------- 그리기 ----------
const cells = [];
function buildGrid() {
  const g = $('grid');
  g.innerHTML = '';
  cells.length = 0;
  for (let i = 0; i < N; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cell'; b.dataset.i = String(i);
    b.onclick = () => onCell(i);
    g.appendChild(b); cells.push(b);
  }
}
function pill(el, name, lines, turn) {
  el.className = 'pill' + (turn ? ' turn' : '');
  el.innerHTML = `<span>${esc(name)}</span><b>${lines}</b>/${TARGET}<span class="dots">${Array.from({ length: TARGET }, (_, i) => `<i class="${i < lines ? 'on' : ''}"></i>`).join('')}</span>`;
}
function render() {
  const m = model();
  const ph = m ? m.phase : 'title';
  const board = m ? m.board : new Array(N).fill(0);
  const called = m ? m.called : [];
  const marks = board.map((v) => v > 0 && called.includes(v));
  const lineCells = new Set();
  for (const li of L.doneLines(marks)) for (const c of L.LINES[li]) lineCells.add(c);
  const canCall = !!m && ph === 'play' && m.myTurn && !waitingNet;
  for (let i = 0; i < N; i++) {
    const v = board[i], el = cells[i];
    el.textContent = v > 0 ? String(v) : '';
    const slot = ph === 'setup' && manual && !v;
    const removable = ph === 'setup' && manual && v === nextNum - 1 && v > 0;
    el.className = 'cell' + (v ? '' : ' empty') + (marks[i] ? ' marked' : '') + (lineCells.has(i) ? ' line' : '') + (v && v === lastCall && ph !== 'setup' ? ' last' : '')
      + (canCall && !marks[i] ? ' can' : '') + (slot ? ' slot' : '') + (removable ? ' can' : '');
    el.disabled = !(canCall && !marks[i]) && !slot && !removable;
  }
  pill($('pillMe'), '나', m ? m.lines[0] : 0, !!m && m.turnIs === 0);
  pill($('pillOp'), oppName(), m ? m.lines[1] : 0, !!m && m.turnIs === 1);
  const h = $('hist');
  h.innerHTML = called.length ? '<span class="lbl">나온 숫자</span>' + called.map((n, i) => `<span class="n ${m.callers[i] === 0 ? 'me' : 'op'}">${n}</span>`).reverse().join('') : '<span class="lbl">숫자를 부르면 여기에 쌓여요</span>';
  // 아래 버튼: 판 만드는 중에만
  const setup = ph === 'setup' && (!online() || !!room && room.state !== 'waiting');
  $('actions').style.display = setup ? '' : 'none';
  const locked = readySent;
  $('shuffleBtn').disabled = locked; $('manualBtn').disabled = locked;
  $('manualBtn').textContent = manual ? '✍️ 다시 채우기' : '✍️ 직접 채우기';
  $('readyBtn').disabled = locked || !full(draft);
  $('readyBtn').classList.toggle('go', !locked && full(draft));
  $('readyBtn').textContent = online() ? (locked ? '⏳ 상대를 기다려요' : '✅ 준비') : '▶ 시작';
  renderHud(m);
}
function renderHud(m = model()) {
  $('wins').textContent = wins.toLocaleString('ko-KR');
  let text = '숫자 빙고';
  const sec = Math.max(0, Math.ceil((turnEnd - performance.now()) / 1000));
  if (m && phase !== 'title' && phase !== 'over' && m.phase !== 'over') {
    if (online() && netDown) text = '연결 다시 붙이는 중…';
    else if (m.phase === 'setup') text = online() ? `내 판 만들기 · ${sec}초` : '내 판 만들기';
    else if (m.myTurn) text = online() ? `내 차례 · 숫자를 눌러요 · ${sec}초` : '내 차례 · 숫자를 눌러요';
    else text = online() ? `${oppName()} 차례 · ${sec}초` : '컴퓨터 차례…';
  }
  $('turn').textContent = text;
  $('resignBtn').style.display = online() && room && (room.state === 'playing' || room.state === 'setup') ? '' : 'none';
}
function say(t) { $('msg').textContent = t; }
function setupMsg() {
  if (readySent) say(online() ? '상대가 준비하길 기다려요…' : '');
  else if (manual) say(nextNum <= N ? `다음에 놓을 숫자: ${nextNum}  (칸을 눌러 놓아요)` : '다 채웠어요! 시작을 눌러요');
  else say('이 판으로 할까요? 섞거나 직접 채울 수 있어요');
}

// ---------- 창 ----------
const overlayOpen = () => !$('overlay').classList.contains('hidden');
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }

// ---------- 판 만들기 ----------
function newDraft() { draft = L.randomBoard(); manual = false; nextNum = 1; readySent = false; }
function onShuffle() {
  if (readySent || phase !== 'setup') return;
  draft = L.randomBoard(); manual = false; nextNum = 1;
  sfx.shuffle(); tutorialSignal('shuffle'); setupMsg(); render();
}
function onManual() {
  if (readySent || phase !== 'setup') return;
  draft = new Array(N).fill(0); manual = true; nextNum = 1;
  sfx.place(); setupMsg(); render();
}
function onReady() {
  if (readySent || phase !== 'setup' || !full(draft)) return;
  tutorialSignal('ready');
  if (online()) { readySent = true; net.send('ready', { board: draft }); setupMsg(); render(); return; }
  startCpuGame();
}

// ---------- 칸 누르기 ----------
function onCell(i) {
  const m = model();
  if (!m) return;
  if (m.phase === 'setup') {
    if (readySent || !manual) return;
    if (!draft[i] && nextNum <= N) { draft[i] = nextNum++; sfx.place(); tutorialSignal('place'); }
    else if (draft[i] === nextNum - 1) { draft[i] = 0; nextNum--; sfx.place(); }
    else return;
    setupMsg(); render();
    return;
  }
  if (m.phase !== 'play' || !m.myTurn || waitingNet) return;
  const num = m.board[i];
  if (!num || m.called.includes(num)) return;
  if (online()) { waitingNet = true; net.send('call', { num }); render(); return; }
  cpuCall(0, num);
}

// ---------- 컴퓨터 대전 ----------
function startCpu(m) {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = m; phase = 'setup'; st = null; newDraft();
  shownCalls = 0; lastCall = 0; myLinesShown = 0; oppLinesShown = 0;
  hideOverlay(); buildGrid(); setupMsg(); render();
}
function startCpuGame() {
  const first = Math.random() < 0.5 ? 0 : 1;
  st = L.newGame({ boards: [draft.slice(), L.randomBoard()], first });
  phase = 'play'; shownCalls = 0; lastCall = 0; myLinesShown = 0;
  say(first === 0 ? '먼저 불러요! 숫자를 눌러요' : '컴퓨터가 먼저 불러요');
  render();
  if (st.turn === 1) cpuTimer = setTimeout(cpuTurn, T.cpu);
}
function cpuTurn() {
  if (phase !== 'play' || !st || st.winner >= 0 || st.turn !== 1 || online()) return;
  cpuCall(1, L.aiPick(st, 1, mode === 'hard' ? 'hard' : 'easy'));
}
function cpuCall(who, num) {
  const before = st.lines.slice();
  const r = L.call(st, who, num);
  if (!r) return;
  lastCall = num;
  announce(who === 0 ? 0 : 1, num, [st.lines[0] - before[0], st.lines[1] - before[1]]);
  if (who === 0) { tutorialSignal('call'); if (st.lines[0] > before[0]) tutorialSignal('line'); }
  render();
  if (st.winner >= 0) { overTimer = setTimeout(showOver, T.over); return; }
  if (st.turn === 1) cpuTimer = setTimeout(cpuTurn, T.cpu);
}
// 이름 뒤에 붙는 '이/가' (받침이 있으면 이)
const ga = (name) => { const c = String(name).charCodeAt(String(name).length - 1) - 0xAC00; return name + (c >= 0 && c <= 11171 && c % 28 ? '이' : '가'); };
// 부른 숫자를 알리는 말과 소리 (who: 0 나, 1 상대)
function announce(who, num, newLines) {
  const mine = who === 0;
  mine ? sfx.mine() : sfx.theirs();
  if (newLines[0] > 0) sfx.line();
  let t = `${mine ? '내가' : ga(oppName())} ${num}${[0, 1, 3, 6, 7, 8].includes(num % 10) ? '을' : '를'} 불렀어요`;
  if (newLines[0] > 0 && newLines[1] > 0) t += ' · 둘 다 줄이 늘었어요!';
  else if (newLines[0] > 0) t += ` · 내 줄 +${newLines[0]}!`;
  else if (newLines[1] > 0) t += ` · 상대 줄 +${newLines[1]}`;
  say(t);
}
function miniBoard(board, called) {
  return `<div class="mini">${board.map((v) => `<span class="${called.includes(v) ? 'm' : ''}">${v}</span>`).join('')}</div>`;
}
function showOver() {
  phase = 'over';
  const youWon = st.winner === 0;
  if (youWon) { wins++; store.set('bingoWins', String(wins)); sfx.win(); } else sfx.lose();
  showOverlay(`
    <h2>${youWon ? '빙고! 이겼어요! 🎉' : '아쉬워요! 😵'}</h2>
    <p>내 줄 <b>${st.lines[0]}</b> : 컴퓨터 줄 <b>${st.lines[1]}</b> · ${st.called.length}번 불렀어요</p>
    <div class="minis"><div><small>내 판</small>${miniBoard(st.boards[0], st.called)}</div><div><small>컴퓨터 판</small>${miniBoard(st.boards[1], st.called)}</div></div>
    <p>컴퓨터 상대 승리 <b>${wins}</b>번</p>
    <div class="col"><button data-act="again">다시 하기</button><button class="sub" data-act="home">처음으로</button></div>`);
  render();
}
function showTitle() {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'easy'; phase = 'title'; st = null; newDraft(); manual = false;
  buildGrid(); say(''); render();
  const on = loadJson(ONLINE_KEY);
  showOverlay(`
    <h1>숫자 빙고</h1>
    <p>1~25 로 내 빙고판을 만들고 번갈아 숫자를 불러요<br><b>먼저 5줄</b>을 만들면 이겨요!</p>
    <div class="card2" style="font-size:13px">가로·세로·대각선 12줄 중 한 줄이 다 지워지면 1줄<br>부른 숫자는 <b>두 판에서 모두</b> 지워져요<br>상대 판은 끝날 때까지 보이지 않아요</div>
    <div class="col"><button data-act="cpu" data-lv="easy">🤖 컴퓨터랑 · 쉬움</button><button class="sub" data-act="cpu" data-lv="hard">🤖 컴퓨터랑 · 어려움</button><button class="sub" data-act="online">🌐 온라인 대전${on.w || on.l ? ` · ${on.w || 0}승 ${on.l || 0}패` : ''}</button></div>`);
}

// ---------- 온라인: 연결 ----------
const net = {
  ws: null, pulse: null, outbox: [], retry: 0,
  connect() {
    if (this.ws && this.ws.readyState <= 1) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}${location.pathname}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.raw('hello', { name: myName() });
      const s = loadSession();
      if (s) this.raw('resume', s);
      for (const [t, p] of this.outbox.splice(0)) this.raw(t, p);
      clearInterval(this.pulse);
      // 프록시가 WebSocket ping 을 대신 받아버리는 환경이 있어 살아있다는 신호를 직접 보낸다
      this.pulse = setInterval(() => this.raw('pulse'), 10000);
    };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } onNet(m); };
    ws.onclose = () => {
      clearInterval(this.pulse);
      if (this.ws !== ws) return;   // 일부러 닫은 연결
      this.ws = null;
      if (!online()) return;
      if (room || loadSession()) {
        // 대국 중이면 계속 다시 붙어본다. 서버는 30초 동안 자리를 비워둔다.
        netDown = true; waitingNet = false; render();
        setTimeout(() => { if (online()) this.connect(); }, Math.min(4000, 500 * 2 ** this.retry++));
      } else showOnline('서버와 연결이 끊겼어요. 다시 시도해 주세요.');
    };
  },
  send(t, p = {}) {
    if (this.ws && this.ws.readyState === 1) this.raw(t, p);
    else { this.outbox.push([t, p]); this.connect(); }
  },
  raw(t, p = {}) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, ...p })); },
  close() {
    const ws = this.ws;
    this.ws = null; this.outbox = [];
    clearInterval(this.pulse);
    if (ws) ws.close();
  },
};

function onNet(m) {
  if (m.t === 'queued') showQueued();
  else if (m.t === 'room') applyRoom(m);
  else if (m.t === 'notice') say(m.msg);
  else if (m.t === 'error') { room = null; saveSession(null); showOnline(m.msg); }
  else if (m.t === 'resumeFailed') {
    saveSession(null);
    if (room) { room = null; showOnline('대국이 끝나서 이어갈 수 없어요.'); }
    netDown = false; render();
  }
}

function leaveOnline() {
  if (!online()) return;
  net.send('leave'); net.close();
  saveSession(null);
  room = null; netDown = false; waitingNet = false; mode = 'easy'; phase = 'title';
}

// ---------- 온라인: 대국 ----------
function applyRoom(r) {
  const fresh = !room || room.code !== r.code;
  const newGame = fresh || room.games !== r.games;
  room = r;
  netDown = false; waitingNet = false;
  saveSession({ code: r.code, token: r.token });
  turnEnd = performance.now() + r.remain;
  if (newGame) {
    shownCalls = r.called.length; lastCall = r.called.length ? r.called[r.called.length - 1] : 0;
    manual = false; nextNum = 1; readySent = !!r.myBoard;
    draft = r.myBoard ? r.myBoard.slice() : L.randomBoard();
    myLinesShown = r.lines[r.you]; oppLinesShown = r.lines[1 - r.you];
    buildGrid();
  }
  if (r.state === 'waiting') { phase = 'setup'; showWaiting(); render(); return; }
  if (r.myBoard) readySent = true;
  phase = r.state === 'setup' ? 'setup' : r.state === 'playing' ? 'play' : 'over';
  if (newGame && r.state === 'setup') sfx.found();
  if (!($('overlay').dataset.screen === 'confirm') && r.state !== 'over') hideOverlay();
  // 새로 불린 숫자
  if (r.called.length > shownCalls && !newGame) {
    lastCall = r.called[r.called.length - 1];
    const who = r.callers[r.callers.length - 1] === r.you ? 0 : 1;
    announce(who, lastCall, [r.lines[r.you] - myLinesShown, r.lines[1 - r.you] - oppLinesShown]);
    if (who === 0) { tutorialSignal('call'); if (r.lines[r.you] > myLinesShown) tutorialSignal('line'); }
    shownCalls = r.called.length;
  }
  myLinesShown = r.lines[r.you]; oppLinesShown = r.lines[1 - r.you];
  if (phase === 'setup') setupMsg();
  if (phase === 'play' && r.called.length === 0 && newGame) say(r.turn === r.you ? '먼저 불러요! 숫자를 눌러요' : `${ga(oppName())} 먼저 불러요`);
  render();
  if (r.state === 'over') afterOver();
}
function afterOver() {
  const r = room;
  const key = `${r.code}:${r.games}:${r.reason}:${r.winner}`;
  if (recorded !== key) {
    recorded = key;
    const rec = loadJson(ONLINE_KEY);
    if (r.winner === r.you) { rec.w = (rec.w || 0) + 1; sfx.win(); } else { rec.l = (rec.l || 0) + 1; sfx.lose(); }
    store.set(ONLINE_KEY, JSON.stringify(rec));
    setTimeout(() => { if (room && room.state === 'over') showResult(); }, T.over);
  } else if (overlayOpen()) showResult();
}

function showResult() {
  const r = room, opp = opponent();
  const won = r.winner === r.you;
  const why = {
    bingo: won ? '먼저 5줄을 만들었어요!' : '상대가 먼저 5줄을 만들었어요',
    resign: won ? '상대가 기권했어요' : '기권했어요',
    timeout: won ? '상대가 시간을 넘겼어요' : '시간을 넘겼어요',
    left: won ? '상대가 나갔어요' : '연결이 끊겨 패배했어요',
  }[r.reason] || '';
  const rec = loadJson(ONLINE_KEY);
  const iVoted = r.rematch.includes(r.you), theyVoted = opp && r.rematch.includes(opp.color);
  let again;
  if (!opp) again = '<p>상대가 방을 나갔어요</p>';
  else if (iVoted) again = '<p>상대를 기다리는 중…</p>';
  else again = `${theyVoted ? '<p>상대가 한 판 더 하고 싶어해요!</p>' : ''}<button data-act="rematch">한 판 더</button>`;
  const boards = r.myBoard ? `<div class="minis"><div><small>내 판</small>${miniBoard(r.myBoard, r.called)}</div>${r.oppBoard ? `<div><small>${esc(oppName())} 판</small>${miniBoard(r.oppBoard, r.called)}</div>` : ''}</div>` : '';
  showOverlay(`
    <h2>${won ? '🎉 승리!' : '😵 패배'}</h2>
    ${why ? `<p>${why}</p>` : ''}
    ${r.called.length ? `<p>내 줄 <b>${r.lines[r.you]}</b> : ${esc(oppName())} 줄 <b>${r.lines[1 - r.you]}</b></p>` : ''}
    ${boards}
    <span class="tag">온라인 ${rec.w || 0}승 ${rec.l || 0}패</span>
    <div class="col">${again}
      <div class="row"><button class="sub" data-act="view">판 보기</button><button class="sub" data-act="leave">나가기</button></div>
    </div>`);
}

function showOnline(error = '') {
  leaveOnline();
  clearTimeout(cpuTimer); clearTimeout(overTimer);
  mode = 'online'; phase = 'title'; room = null; st = null; waitingNet = false;
  newDraft(); buildGrid(); say(''); render();
  showOverlay(`
    <h2>🌐 온라인 대전</h2>
    <input id="nameInput" maxlength="10" placeholder="내 이름 (최대 10자)" value="${esc(myName())}" autocomplete="off">
    <div class="col">
      <button data-act="quick">⚡ 빠른 대전</button>
      <button class="sub" data-act="create">방 만들기</button>
      <div class="row join"><input id="codeInput" maxlength="4" placeholder="방 코드" autocomplete="off" autocapitalize="characters"><button class="sub" data-act="join">들어가기</button></div>
    </div>
    <span class="error">${esc(error)}</span>
    <button class="back" data-act="home">← 처음으로</button>
    <p style="font-size:12.5px">판 만들기 60초 · 숫자는 부를 때마다 30초 · 먼저 부르는 쪽은 한 판마다 바뀌어요</p>`);
}
function showQueued() {
  showOverlay(`
    <h2>상대를 찾는 중…</h2>
    <div class="dots"><span></span><span></span><span></span></div>
    <p>누군가 빠른 대전을 누르면 바로 시작해요</p>
    <button class="sub" data-act="cancel">취소</button>`);
}
const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
function showWaiting() {
  showOverlay(`
    <h2>친구를 기다리는 중…</h2>
    <p>방 코드</p>
    <div class="code">${esc(room.code)}</div>
    <p>친구가 <b>온라인 대전 → 들어가기</b>에<br>이 코드를 넣으면 시작해요</p>
    <button data-act="copy">🔗 초대 링크 복사</button>
    <button class="sub" data-act="cancel">취소</button>`);
}
function saveName() {
  const input = $('nameInput');
  if (!input) return;
  const name = input.value.trim().slice(0, 10);
  store.set('bingoName', name);
  net.send('hello', { name });
}
function confirmResign() {
  showOverlay(`<h2>기권할까요?</h2><p>이번 판은 패배로 기록돼요</p>
    <div class="row"><button data-act="close">계속하기</button><button class="sub" data-act="resign">🏳 기권</button></div>`);
  $('overlay').dataset.screen = 'confirm';
}

$('overlay').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  btn.blur();
  $('overlay').dataset.screen = '';
  const act = btn.dataset.act;
  if (act === 'cpu') startCpu(btn.dataset.lv);
  else if (act === 'again') startCpu(mode);
  else if (act === 'home') showTitle();
  else if (act === 'online') showOnline();
  else if (act === 'quick') { saveName(); net.send('quick'); }
  else if (act === 'create') { saveName(); net.send('create'); }
  else if (act === 'join') {
    const code = ($('codeInput').value || '').trim().toUpperCase();
    if (code.length !== 4) { $('overlay').querySelector('.error').textContent = '방 코드 4자리를 넣어 주세요.'; return; }
    saveName();
    net.send('join', { code });
  } else if (act === 'cancel') { net.send('cancel'); showOnline(); }
  else if (act === 'copy') {
    const url = inviteUrl();
    const done = () => { btn.textContent = '✅ 복사했어요'; setTimeout(() => { btn.textContent = '🔗 초대 링크 복사'; }, 1500); };
    if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: '숫자 빙고 한 판 해요!', url }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, () => prompt('링크를 복사하세요', url));
    else prompt('링크를 복사하세요', url);
  } else if (act === 'rematch') { net.send('rematch'); }
  else if (act === 'view') hideOverlay();
  else if (act === 'leave') showOnline();
  else if (act === 'resign') { net.send('resign'); hideOverlay(); }
  else if (act === 'close') hideOverlay();
});
$('overlay').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'codeInput') $('overlay').querySelector('[data-act="join"]').click();
  if (e.target.id === 'nameInput') $('overlay').querySelector('[data-act="quick"]').click();
  e.stopPropagation();
});
$('resignBtn').onclick = (e) => { e.currentTarget.blur(); if (online() && room && (room.state === 'playing' || room.state === 'setup')) confirmResign(); };
$('shuffleBtn').onclick = (e) => { e.currentTarget.blur(); onShuffle(); };
$('manualBtn').onclick = (e) => { e.currentTarget.blur(); onManual(); };
$('readyBtn').onclick = (e) => { e.currentTarget.blur(); onReady(); };
addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT' && e.code === 'KeyM') toggleMute(); });
setInterval(() => { if (online() && room && (room.state === 'playing' || room.state === 'setup') && !netDown) renderHud(); }, 500);

// ---------- 시작 ----------
// 초대 링크(?room=CODE)로 들어왔거나, 새로고침 전에 하던 대국이 있으면 온라인으로 바로 간다
const invite = new URLSearchParams(location.search).get('room');
if (invite) { try { window.history.replaceState(null, '', location.pathname); } catch (_) {} }
function joinInvite(code) { showOnline(); net.send('join', { code: code.toUpperCase() }); }
if (loadSession()) {
  mode = 'online';
  buildGrid();
  showOverlay('<h2>대국으로 돌아가는 중…</h2>');
  net.connect();
  const until = setInterval(() => {
    if (room || !loadSession()) { clearInterval(until); if (!room) invite ? joinInvite(invite) : showOnline(); }
  }, 100);
} else if (invite) joinInvite(invite);
else showTitle();

/* @test-hooks:start */
window.__bingo = { get st() { return st; }, get mode() { return mode; }, get phase() { return phase; }, get room() { return room; }, get draft() { return draft; }, T, onCell, onShuffle, onManual, onReady, startCpu };
/* @test-hooks:end */
})();
