// Échiquier natif de l'explicateur (js/explain/board64.js) contre chess.js — spec §6.2 item 7.
// node --test tools/test/attackset.test.mjs   (QUICK=1 : moins de parties pour les coups légaux ; les 10 000 positions restent)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../../vendor/chess.js';
import { parse, attackSet, attacked, name, legalMoves, sanOf, uciOf, findMove, play, fenOf } from '../../js/explain/board64.js';
import { mulberry32 } from '../../js/drill/geom.js';
import { N } from './harness.mjs';

const PIECES = 'PNBRQpnbrq';
// Position au hasard : deux rois, 0 à 24 autres pièces, pions hors des rangées 1 et 8 (légalité non exigée).
function randomFen(rng) {
  const g = new Array(64).fill('');
  const free = () => { for (;;) { const i = Math.floor(rng() * 64); if (!g[i]) return i; } };
  g[free()] = 'K'; g[free()] = 'k';
  const n = Math.floor(rng() * 25);
  for (let k = 0; k < n; k++) {
    const p = PIECES[Math.floor(rng() * PIECES.length)];
    let i = free();
    if (p.toLowerCase() === 'p') for (let t = 0; t < 20 && (i < 8 || i >= 56); t++) i = free();
    if (p.toLowerCase() === 'p' && (i < 8 || i >= 56)) continue;
    g[i] = p;
  }
  let s = '';
  for (let r = 7; r >= 0; r--) {
    let e = 0;
    for (let f = 0; f < 8; f++) { const p = g[r * 8 + f]; if (!p) { e++; continue; } if (e) { s += e; e = 0; } s += p; }
    if (e) s += e;
    if (r) s += '/';
  }
  return `${s} ${rng() < 0.5 ? 'w' : 'b'} - - 0 1`;
}
const loose = fen => new Chess(fen, { skipValidation: true });

test('attackSet == chess.isAttacked sur 10 000 positions au hasard (les deux camps, 64 cases)', () => {
  const rng = mulberry32(2024);
  let bad = 0, first = null;
  for (let k = 0; k < 10000; k++) {
    const fen = randomFen(rng), c = loose(fen), { g } = parse(fen);
    for (const col of ['w', 'b']) {
      const A = attackSet(g, col);
      for (let i = 0; i < 64; i++) {
        const want = c.isAttacked(name(i), col);
        if (!!A[i] !== want || attacked(g, i, col) !== want) { bad++; first ||= `${fen} ${name(i)} ${col}`; }
      }
    }
  }
  assert.equal(bad, 0, `désaccords : ${bad}, premier : ${first}`);
});

test('attackSet : ghost (case transparente) et skip (pièce ignorée) == pièce retirée dans chess.js', () => {
  const rng = mulberry32(7);
  let bad = 0, first = null;
  for (let k = 0; k < 2000; k++) {
    const fen = randomFen(rng), { g } = parse(fen);
    const occ = g.map((p, i) => (p ? i : -1)).filter(i => i >= 0);
    const s = occ[Math.floor(rng() * occ.length)];
    const col = rng() < 0.5 ? 'w' : 'b';
    const c = loose(fen);
    c.remove(name(s));
    const isOwn = (g[s] < 'a') === (col === 'w');
    // skip : la pièce n'attaque plus et ne bloque plus ; ghost : elle ne bloque plus (pièce adverse : même chose que retirée)
    const variants = [['skip', attackSet(g, col, { skip: s })]];
    if (!isOwn) variants.push(['ghost', attackSet(g, col, { ghost: s })]);
    for (const [kind, A] of variants) for (let i = 0; i < 64; i++) {
      if (i === s) continue;   // la case vidée : chess.js la voit vide, nous gardons la pièce posée
      if (!!A[i] !== c.isAttacked(name(i), col)) { bad++; first ||= `${kind} ${fen} ${name(s)} ${name(i)} ${col}`; }
    }
  }
  assert.equal(bad, 0, `désaccords : ${bad}, premier : ${first}`);
});

test('coups légaux, SAN et FEN natifs == chess.js le long de parties au hasard', () => {
  const rng = mulberry32(99);
  const games = N(8, 30, 300);
  let n = 0, bad = 0, first = null;
  for (let k = 0; k < games; k++) {
    const c = new Chess();
    for (let ply = 0; ply < 120 && !c.isGameOver(); ply++) {
      const pos = parse(c.fen());
      const ref = c.moves({ verbose: true });
      const mine = legalMoves(pos);
      n++;
      const a = ref.map(m => m.lan).sort().join(), b = mine.map(uciOf).sort().join();
      if (a !== b) { bad++; first ||= `coups ${c.fen()}`; }
      for (const m of mine) {
        const r = ref.find(x => x.lan === uciOf(m));
        if (r && r.san !== sanOf(pos, m, mine)) { bad++; first ||= `SAN ${c.fen()} ${r.san}`; }
      }
      const mv = ref[Math.floor(rng() * ref.length)];
      const np = play(pos, findMove(pos, mv.lan, mine));
      c.move(mv);
      const f1 = c.fen().split(' ').slice(0, 4).join(' '), f2 = fenOf(np).split(' ').slice(0, 4).join(' ');
      // chess.js n'écrit la case de prise en passant que si une prise est possible
      if (f1 !== f2 && f2.replace(/ [a-h][36]$/, ' -') !== f1) { bad++; first ||= `FEN ${f1} | ${f2}`; }
    }
  }
  assert.ok(n > games * 20, `trop peu de positions : ${n}`);
  assert.equal(bad, 0, `désaccords : ${bad}, premier : ${first}`);
});
