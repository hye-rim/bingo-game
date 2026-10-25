'use strict';

// 서버 시험: 보안·안정성 회귀 + 숫자 빙고 온라인 대국 흐름
// 실행: npm test  (Node 18 이상, 별도 설치 없이 node:test)
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { WebSocket } = require('ws');
const L = require('../public/logic.js');

// 운영체제가 지금 비어 있는 포트를 골라 준다 (고정 포트·범위 난수는 다른 서버와 겹쳐 가끔 실패한다)
const freePort = () => Number(require('child_process').execFileSync(process.execPath, ['-e', "const s = require('net').createServer().listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); })"]));
const PORT = freePort();
const get = (p) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('error', reject); req.end();
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), TURN_MS: '2500', SETUP_MS: '2500' }, stdio: 'ignore' });
child.unref();
process.on('exit', () => child.kill());
const ready = (async () => {
  for (let i = 0; i < 80; i++) { try { await get('/'); return; } catch { await sleep(100); } }
  throw new Error('server did not start');
})();

const open = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/`);
  const c = { ws, msgs: [], room: null, queued: false, errors: [], notices: [], closed: null };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch { return; }
    c.msgs.push(m);
    if (m.t === 'room') c.room = m;
    if (m.t === 'queued') c.queued = true;
    if (m.t === 'error') c.errors.push(m.msg);
    if (m.t === 'notice') c.notices.push(m.msg);
  });
  ws.on('close', (code) => { c.closed = code; });
  ws.on('error', () => {});
  ws.on('open', () => resolve(c));
  setTimeout(() => reject(new Error('websocket connect failed')), 3000);
});
const send = (c, t, p = {}) => c.ws.send(JSON.stringify({ t, ...p }));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(15); } return false; };

// 두 손님을 빠른 대전으로 맺어 준다 (판 만드는 중)
async function pair() {
  const a = await open(), b = await open();
  send(a, 'hello', { name: '가' }); send(b, 'hello', { name: '나' });
  send(a, 'quick'); await until(() => a.queued);
  send(b, 'quick');
  assert.ok(await until(() => a.room && b.room && a.room.state === 'setup' && b.room.state === 'setup'), 'both players enter a setup room');
  return [a, b];
}
// 둘 다 판을 정하고 준비해서 대국을 시작한다
async function startPlay() {
  const [a, b] = await pair();
  a.board = L.randomBoard(); b.board = L.randomBoard();
  send(a, 'ready', { board: a.board }); send(b, 'ready', { board: b.board });
  assert.ok(await until(() => a.room.state === 'playing' && b.room.state === 'playing'), 'the game starts when both are ready');
  return [a, b];
}
const mover = (a, b) => (a.room.turn === a.room.you ? a : b);
const sameCalls = (a, b) => JSON.stringify(a.room.called) === JSON.stringify(b.room.called);

test('malformed URLs get 400 and the server stays up', async () => {
  await ready;
  assert.strictEqual(await get('/%'), 400);
  assert.strictEqual(await get('/%00'), 400);
  assert.strictEqual(await get('/'), 200);
  assert.strictEqual(await get('/logic.js'), 200);
});

test('dotfiles and paths outside the public dir are not served', async () => {
  await ready;
  assert.strictEqual(await get('/.git/config'), 403);
  assert.ok([403, 404].includes(await get('/../server.js')));
});

test('oversized websocket message closes the connection (1009)', async () => {
  await ready;
  const c = await open();
  c.ws.send('x'.repeat(2 * 1024 * 1024));
  await sleep(500);
  assert.strictEqual(c.closed, 1009);
  assert.strictEqual(await get('/'), 200);
});

test('quick match puts two players in setup, neither ready', async () => {
  await ready;
  const [a, b] = await pair();
  assert.strictEqual(a.room.code, b.room.code);
  assert.notStrictEqual(a.room.you, b.room.you);
  assert.ok(a.room.players.every((p) => !p.ready));
  assert.strictEqual(a.room.myBoard, null);
  a.ws.close(); b.ws.close();
});

test('boards that are not 1 to 25 once each are refused', async () => {
  await ready;
  const [a, b] = await pair();
  const good = L.randomBoard();
  const bads = [null, 'abc', [], good.slice(1), [...good.slice(0, 24), good[0]], [...good.slice(0, 24), 26], [...good.slice(0, 24), '25'], [...good.slice(0, 24), 1.5], good.concat([1]), { length: 25 }];
  for (const bad of bads) send(a, 'ready', { board: bad });
  send(a, 'ready', {});
  await sleep(300);
  assert.ok(a.notices.length >= bads.length, 'each bad board gets a notice');
  assert.ok(!a.room.players.some((p) => p.ready), 'nobody became ready');
  assert.strictEqual(a.room.state, 'setup');
  send(a, 'ready', { board: good });
  assert.ok(await until(() => a.room.players.some((p) => p.ready)));
  assert.deepStrictEqual(a.room.myBoard, good);
  a.ws.close(); b.ws.close();
});

test('the game starts when both are ready, and the other board stays secret', async () => {
  await ready;
  const [a, b] = await startPlay();
  assert.strictEqual(a.room.turn, 0);
  assert.deepStrictEqual(a.room.myBoard, a.board);
  assert.deepStrictEqual(b.room.myBoard, b.board);
  assert.strictEqual(a.room.oppBoard, null);
  assert.strictEqual(b.room.oppBoard, null);
  const raw = JSON.stringify(a.msgs);
  assert.ok(!raw.includes(JSON.stringify(b.board)), 'the other board never reached this player');
  a.ws.close(); b.ws.close();
});

test('out-of-turn, repeated and garbage calls are ignored', async () => {
  await ready;
  const [a, b] = await startPlay();
  const m = mover(a, b), other = m === a ? b : a;
  send(other, 'call', { num: 5 });                                   // 내 차례가 아님
  for (const bad of [{}, { num: 0 }, { num: 26 }, { num: -1 }, { num: 1.5 }, { num: '5' }, { num: null }, { num: 1e999 }, { num: [5] }]) send(m, 'call', bad);
  await sleep(300);
  assert.deepStrictEqual(m.room.called, []);
  send(m, 'call', { num: 7 });
  assert.ok(await until(() => a.room.called.length === 1 && b.room.called.length === 1));
  send(m, 'call', { num: 8 });                                       // 이제 상대 차례
  send(other, 'call', { num: 7 });                                   // 이미 나온 숫자
  await sleep(250);
  assert.deepStrictEqual(a.room.called, [7]);
  assert.strictEqual(a.room.turn, other.room.you);
  a.ws.close(); b.ws.close();
});

test('a call is shared and line counts match the boards', async () => {
  await ready;
  const [a, b] = await startPlay();
  let n = 0;
  while (a.room.state === 'playing' && n < 8) {
    const m = mover(a, b), free = L.uncalled({ called: m.room.called });
    send(m, 'call', { num: free[Math.floor(Math.random() * free.length)] });
    n++;
    assert.ok(await until(() => a.room.called.length === n && b.room.called.length === n));
  }
  assert.ok(sameCalls(a, b));
  for (const c of [a, b]) {
    const marks = c.room.myBoard.map((v) => c.room.called.includes(v));
    assert.strictEqual(c.room.lines[c.room.you], L.doneLines(marks).length);
  }
  assert.deepStrictEqual(a.room.lines, b.room.lines);
  a.ws.close(); b.ws.close();
});

test('a full game between two bots ends with five lines and reveals both boards', async () => {
  await ready;
  const [a, b] = await startPlay();
  let n = 0;
  while (a.room.state === 'playing' && n < 30) {
    const m = mover(a, b), prev = m.room.called.length;
    const pick = L.aiPick({ boards: [m.room.myBoard, m.room.myBoard], marks: [m.room.myBoard.map((v) => m.room.called.includes(v)), m.room.myBoard.map((v) => m.room.called.includes(v))], called: m.room.called, rand: Math.random }, 0, 'hard', Math.random);
    send(m, 'call', { num: pick });
    n++;
    await until(() => (a.room.called.length > prev && b.room.called.length > prev) || a.room.state === 'over');
  }
  assert.ok(await until(() => a.room.state === 'over' && b.room.state === 'over'), 'the game ends');
  assert.strictEqual(a.room.reason, 'bingo');
  assert.strictEqual(a.room.winner, b.room.winner);
  const w = a.room.winner;
  assert.ok(a.room.lines[w] >= 5);
  assert.deepStrictEqual(a.room.oppBoard, b.room.myBoard, 'the other board is shown at the end');
  assert.deepStrictEqual(b.room.oppBoard, a.room.myBoard);
  // 서버가 정한 승패를 판과 부른 숫자로 다시 계산해도 같다
  const boards = [null, null];
  boards[a.room.you] = a.room.myBoard; boards[b.room.you] = b.room.myBoard;
  const g = L.newGame({ boards, first: 0 });
  for (const num of a.room.called) assert.ok(L.call(g, g.turn, num), 'replay of call ' + num);
  assert.strictEqual(g.winner, w);
  a.ws.close(); b.ws.close();
});

test('resigning ends the game and rematch swaps who calls first, with a fresh setup', async () => {
  await ready;
  const [a, b] = await startPlay();
  const colorA = a.room.you;
  send(a, 'resign');
  assert.ok(await until(() => b.room.state === 'over'));
  assert.strictEqual(b.room.reason, 'resign');
  assert.strictEqual(b.room.winner, b.room.you);
  send(a, 'rematch'); send(b, 'rematch');
  assert.ok(await until(() => a.room.state === 'setup' && a.room.games === 2));
  assert.notStrictEqual(a.room.you, colorA, 'colors swap on a rematch');
  assert.strictEqual(a.room.myBoard, null);
  assert.deepStrictEqual(a.room.called, []);
  a.ws.close(); b.ws.close();
});

test('running out of time in a game loses it for the one on move', async () => {
  await ready;
  const [a, b] = await startPlay();
  const first = mover(a, b);
  assert.ok(await until(() => a.room.state === 'over', 5000), 'the timer fires');
  assert.strictEqual(a.room.reason, 'timeout');
  assert.strictEqual(a.room.winner, 1 - first.room.you);
  a.ws.close(); b.ws.close();
});

test('in setup, the player who is not ready when time runs out loses', async () => {
  await ready;
  const [a, b] = await pair();
  send(a, 'ready', { board: L.randomBoard() });
  assert.ok(await until(() => a.room.state === 'over' && b.room.state === 'over', 5000), 'the setup timer fires');
  assert.strictEqual(a.room.reason, 'timeout');
  assert.strictEqual(a.room.winner, a.room.you);
  assert.strictEqual(b.room.winner, a.room.you);
  a.ws.close(); b.ws.close();
});

test('in setup, nobody ready closes the room', async () => {
  await ready;
  const [a, b] = await pair();
  assert.ok(await until(() => a.errors.length > 0 && b.errors.length > 0, 5000));
  assert.match(a.errors[0], /준비 시간/);
  a.ws.close(); b.ws.close();
});

test('private rooms: create, join by code, and a third player is turned away', async () => {
  await ready;
  const a = await open(), b = await open(), c = await open();
  send(a, 'create');
  assert.ok(await until(() => a.room && a.room.code));
  assert.strictEqual(a.room.state, 'waiting');
  send(b, 'join', { code: a.room.code.toLowerCase() });
  assert.ok(await until(() => a.room.state === 'setup' && b.room && b.room.state === 'setup'));
  send(c, 'join', { code: a.room.code });
  assert.ok(await until(() => c.errors.length > 0));
  assert.match(c.errors[0], /이미 두 사람/);
  a.ws.close(); b.ws.close(); c.ws.close();
});

test('a dropped player can resume the same seat, in setup and in play', async () => {
  await ready;
  const [a, b] = await pair();
  const board = L.randomBoard();
  send(a, 'ready', { board });
  assert.ok(await until(() => a.room.myBoard));
  const token = a.room.token, code = a.room.code, you = a.room.you;
  a.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)), 'the other side sees the drop');
  const a2 = await open();
  send(a2, 'resume', { code, token });
  assert.ok(await until(() => a2.room && a2.room.you === you && a2.room.state === 'setup'));
  assert.deepStrictEqual(a2.room.myBoard, board, 'the board is kept');
  send(b, 'ready', { board: L.randomBoard() });
  assert.ok(await until(() => a2.room.state === 'playing'));
  a2.ws.close();
  assert.ok(await until(() => b.room.players.some((p) => !p.online)));
  const a3 = await open();
  send(a3, 'resume', { code, token });
  assert.ok(await until(() => a3.room && a3.room.state === 'playing' && a3.room.you === you));
  a3.ws.close(); b.ws.close();
});

// 같은 주소에서 코드를 일부러 많이 틀리므로 이 시험은 맨 뒤에 둔다 (뒤의 시험이 막히지 않게)
test('repeated wrong room codes get temporarily blocked', async () => {
  await ready;
  const c = await open();
  for (let i = 0; i < 10; i++) c.ws.send(JSON.stringify({ t: 'join', code: 'ZZZ' + 'ABCDEFGH'[i] }));
  await sleep(500);
  assert.ok(c.errors.some((x) => /그런 방이 없어요/.test(x)), 'first attempts are answered with room-not-found');
  assert.ok(c.errors.some((x) => /너무 많이 틀렸어요/.test(x)), 'many wrong codes get blocked');
  c.ws.close();
});

test('shutdown', () => { child.kill(); });
