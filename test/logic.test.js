'use strict';
const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');

const seq = (n) => Array.from({ length: n }, (_, i) => i + 1);
const identity = seq(25);                              // 칸 번호 + 1 이 적힌 판
const reversed = seq(25).reverse();

test('there are twelve lines of five distinct cells', () => {
  assert.strictEqual(L.LINES.length, 12);
  for (const ln of L.LINES) { assert.strictEqual(ln.length, 5); assert.strictEqual(new Set(ln).size, 5); }
  assert.deepStrictEqual(L.LINES[0], [0, 1, 2, 3, 4]);
  assert.deepStrictEqual(L.LINES[5], [0, 5, 10, 15, 20]);
  assert.deepStrictEqual(L.LINES[6], [1, 6, 11, 16, 21]);
  assert.deepStrictEqual(L.LINES[10], [0, 6, 12, 18, 24]);
  assert.deepStrictEqual(L.LINES[11], [4, 8, 12, 16, 20]);
});

test('random boards hold 1 to 25 once each and differ by seed', () => {
  for (let s = 1; s <= 100; s++) assert.ok(L.validBoard(L.randomBoard(L.rng(s))));
  assert.notDeepStrictEqual(L.randomBoard(L.rng(1)), L.randomBoard(L.rng(2)));
  assert.deepStrictEqual(L.randomBoard(L.rng(7)), L.randomBoard(L.rng(7)));
});

test('validBoard rejects anything but a permutation of 1 to 25', () => {
  assert.ok(L.validBoard(identity));
  assert.ok(!L.validBoard(null));
  assert.ok(!L.validBoard(identity.slice(1)));
  assert.ok(!L.validBoard([...identity.slice(0, 24), 24]));      // 중복
  assert.ok(!L.validBoard([...identity.slice(0, 24), 26]));      // 범위 밖
  assert.ok(!L.validBoard([...identity.slice(0, 24), 25.5]));
  assert.ok(!L.validBoard([...identity.slice(0, 24), '25']));
  assert.ok(!L.validBoard(identity.concat([1])));
});

test('doneLines counts rows columns and diagonals', () => {
  const m = new Array(25).fill(false);
  assert.deepStrictEqual(L.doneLines(m), []);
  for (const c of [0, 1, 2, 3, 4]) m[c] = true;
  assert.deepStrictEqual(L.doneLines(m), [0]);
  for (const c of [5, 10, 15, 20]) m[c] = true;                    // 첫 열도 완성 (0 칸은 겹침)
  assert.deepStrictEqual(L.doneLines(m), [0, 5]);
  const d = new Array(25).fill(false);
  for (const c of [0, 6, 12, 18, 24]) d[c] = true;
  assert.deepStrictEqual(L.doneLines(d), [10]);
  const all = new Array(25).fill(true);
  assert.strictEqual(L.doneLines(all).length, 12);
});

test('a call marks the number on both boards', () => {
  const st = L.newGame({ boards: [identity, reversed], first: 0 });
  const r = L.call(st, 0, 3);
  assert.strictEqual(r.num, 3);
  assert.ok(st.marks[0][2]);                                       // 3 은 첫 판 2 번 칸
  assert.ok(st.marks[1][22]);                                      // 뒤집힌 판에서는 22 번 칸
  assert.strictEqual(st.marks[0].filter(Boolean).length, 1);
  assert.strictEqual(st.marks[1].filter(Boolean).length, 1);
  assert.deepStrictEqual(st.called, [3]);
  assert.strictEqual(st.turn, 1);
});

test('calls must come in turn, once each, from 1 to 25', () => {
  const st = L.newGame({ boards: [identity, reversed], first: 0 });
  assert.strictEqual(L.call(st, 1, 5), null);                      // 내 차례가 아님
  assert.ok(L.call(st, 0, 5));
  assert.strictEqual(L.call(st, 1, 5), null);                      // 이미 나온 숫자
  for (const bad of [0, 26, -1, 1.5, '3', null, undefined, NaN]) assert.strictEqual(L.call(st, 1, bad), null, String(bad));
  assert.deepStrictEqual(st.called, [5]);
  assert.strictEqual(st.turn, 1);
});

test('line counts update and report new lines', () => {
  const st = L.newGame({ boards: [identity, reversed], first: 0 });
  // 첫 판의 첫 줄은 1~5. 내 차례마다 1~5 를 번갈아 부른다
  const order = [[0, 1], [1, 2], [0, 3], [1, 4], [0, 5]];
  let last;
  for (const [who, n] of order) last = L.call(st, who, n);
  assert.strictEqual(st.lines[0], 1);
  assert.deepStrictEqual(last.newLines, [1, 1]);
  assert.strictEqual(st.lines[1], 1, 'the reversed board gets its bottom row from 1 to 5 as well');
  assert.strictEqual(st.winner, -1);
});

test('five lines wins; the caller wins when both reach five on one call', () => {
  // 같은 판 둘: 부른 숫자가 항상 두 판에서 같은 칸이라 줄 수가 같이 올라간다
  const st = L.newGame({ boards: [identity, identity], first: 0 });
  let who = 0, res;
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) {
    if (st.winner >= 0) break;
    res = L.call(st, who, n);
    who = st.turn;
  }
  assert.ok(st.winner >= 0);
  assert.strictEqual(st.lines[0], st.lines[1]);
  assert.strictEqual(st.winner, st.callers[st.callers.length - 1], 'the last caller wins a tie');
  assert.strictEqual(res.winner, st.winner);
  assert.strictEqual(L.call(st, st.turn, 25), null, 'no calls after the game ends');
});

test('the other player can win by a number the caller called', () => {
  const st = L.newGame({ boards: [identity, identity], first: 0 });
  for (let c = 0; c < 20; c++) st.marks[1][c] = true;              // 둘째 사람 판: 가로 4줄이 지워진 상태 (맨 아랫줄만 비었다)
  st.called = identity.slice(0, 20);
  st.marks[0][0] = true;                                           // 첫째 사람은 한 칸만 지워진 상태
  st.lines = [0, L.doneLines(st.marks[1]).length];
  assert.strictEqual(st.lines[1], 4);
  const r = L.call(st, 0, 21);                                     // 21 은 맨 아랫줄 첫 칸: 첫 세로줄이 완성된다
  assert.ok(r, 'call accepted');
  assert.ok(st.lines[1] >= 5, 'the caller completed the other board (column 1 and the anti-diagonal)');
  assert.strictEqual(st.lines[0], 0);
  assert.strictEqual(st.winner, 1, 'the other player wins');
  assert.strictEqual(r.winner, 1);
});

test('a full game always ends within 25 calls', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const st = L.newGame({ seed, first: seed % 2 });
    let n = 0;
    while (st.winner < 0) {
      assert.ok(++n <= 25, 'seed ' + seed);
      const pick = L.aiPick(st, st.turn, 'easy');
      assert.ok(pick && L.call(st, st.turn, pick));
    }
    assert.ok(st.lines[st.winner] >= 5);
  }
});

test('ai picks only numbers that are still free', () => {
  for (const level of ['easy', 'hard']) {
    const st = L.newGame({ seed: 3, first: 0 });
    for (let i = 0; i < 12; i++) L.call(st, st.turn, L.aiPick(st, st.turn, level));
    const free = new Set(L.uncalled(st));
    for (let k = 0; k < 20; k++) assert.ok(free.has(L.aiPick(st, st.turn, level)), level);
  }
  const st = L.newGame({ seed: 1, first: 0 });
  st.called = identity.slice();
  assert.strictEqual(L.aiPick(st, 0, 'hard'), null);
});

test('the best ai prefers the number that fills a nearly complete line', () => {
  const st = L.newGame({ boards: [identity, reversed], first: 0 });
  for (const c of [0, 1, 2, 3]) st.marks[0][c] = true;             // 첫 줄에서 4칸이 이미 지워짐 (숫자 5 만 남음)
  st.called = [1, 2, 3, 4];
  for (let i = 0; i < 20; i++) assert.strictEqual(L.aiPick(st, 0, 'best', Math.random), 5);
  assert.strictEqual(L.aiPick(st, 0, 'hard', () => 0.1), 5, 'hard plays it when it is in a careful mood');
});

test('hard ai is only careful some of the time, so it sometimes plays a random number', () => {
  const st = L.newGame({ boards: [identity, reversed], first: 0 });
  for (const c of [0, 1, 2, 3]) st.marks[0][c] = true;
  st.called = [1, 2, 3, 4];
  assert.ok(L.SKILL > 0.4 && L.SKILL < 0.9);
  let careful = 0;
  const n = 4000, rand = (() => { let a = 99; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
  for (let i = 0; i < n; i++) if (L.aiPick(st, 0, 'hard', rand) === 5) careful++;
  assert.ok(Math.abs(careful / n - (L.SKILL + (1 - L.SKILL) / 21)) < 0.04, 'careful share ' + careful / n);
});

function playMatch(levelFor, games) {
  let firstSideWins = 0;
  for (let s = 1; s <= games; s++) {
    const st = L.newGame({ seed: s, first: s % 2 });
    const lv = s % 2 ? [levelFor[0], levelFor[1]] : [levelFor[1], levelFor[0]];   // 먼저 하는 쪽을 번갈아 둔다
    const rand = L.rng(s * 13 + 5);
    while (st.winner < 0) L.call(st, st.turn, L.aiPick(st, st.turn, lv[st.turn], rand));
    if (lv[st.winner] === levelFor[0]) firstSideWins++;
  }
  return firstSideWins / games;
}

test('hard beats easy by a wide margin', () => {
  const r = playMatch(['hard', 'easy'], 800);
  assert.ok(r > 0.75 && r < 0.95, 'hard won ' + r);
});

test('hard can be beaten: the best play wins most games against it but not all', () => {
  const r = playMatch(['best', 'hard'], 800);
  assert.ok(r > 0.6, 'best play should be ahead, got ' + r);
  assert.ok(r < 0.92, 'but hard must win some, best won ' + r);
});
