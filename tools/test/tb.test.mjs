// Tables exactes à 3 pièces : reconstruction, format, symétries, cohérence des distances, politiques, moteur.
// node --test tools/test/tb.test.mjs   (QUICK=1 : échantillons réduits)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Chess } from '../../vendor/chess.js';
import { mirrorFiles, swapColors } from '../../js/analysis.js';
import { nullMoveFen } from '../../js/util.js';
import { buildAll } from '../../js/tb/build.js';
import { tbFromBytes, TRI, SIZES, adj } from '../../js/tb/probe.js';
import { loadTBFromFs } from './tb-fs.mjs';
import { nodeEngine } from './node-engine.mjs';

const QUICK = !!process.env.QUICK;
const N_SYM = QUICK ? 2000 : 10000;   // positions légales aléatoires par table (symétries, mat/pat)
const N_GEN = QUICK ? 150 : 500;      // positions par table comparées à la génération de coups de chess.js
const N_PLAY = QUICK ? 30 : 120;      // parties têtu contre piégeur par table
const N_ENG = QUICK ? 30 : 150;       // positions vérifiées par Stockfish
const DIR = new URL('../../data/tb/', import.meta.url);
const tb = await loadTBFromFs();

// ---------- Outils ----------
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const name = s => 'abcdefgh'[s & 7] + ((s >> 3) + 1);
function fenOf(pieces, turn) { // pieces : [[case, lettre], ...]
  const rows = [...Array(8)].map(() => Array(8).fill('.'));
  for (const [s, c] of pieces) rows[7 - (s >> 3)][s & 7] = c;
  return rows.map(r => r.join('').replace(/\.+/g, m => m.length)).join('/') + ` ${turn} - - 0 1`;
}
const PIECE = { KQK: 'Q', KRK: 'R', KPK: 'P' };
// Position aléatoire : couleur forte et trait au hasard, rois jamais au contact, pion hors des rangées 1 et 8.
function randomFen(rng, sig) {
  const r64 = () => Math.floor(rng() * 64);
  for (;;) {
    const a = r64(), b = r64(), x = r64();
    if (a === b || a === x || b === x || adj(a, b)) continue;
    if (sig === 'KPK' && (x < 8 || x >= 56)) continue;
    const black = rng() < 0.5, p = PIECE[sig];
    return fenOf([[a, 'K'], [b, 'k'], [x, black ? p.toLowerCase() : p]], rng() < 0.5 ? 'w' : 'b');
  }
}
const legalFen = fen => !new Chess(nullMoveFen(fen)).isCheck();
const toMove = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
const flip = c => (c === 'w' ? 'b' : 'w');

// ---------- Construction et format ----------
test('reconstruction : octet pour octet identique à data/tb/*.bin', () => {
  const t0 = performance.now();
  const b = buildAll();
  const ms = performance.now() - t0;
  for (const n of ['kqk', 'krk', 'kpk']) {
    const disk = readFileSync(new URL(n + '.bin', DIR));
    assert.equal(disk.length, SIZES[n], `${n}.bin : taille`);
    assert.equal(b[n].length, SIZES[n]);
    assert.ok(Buffer.from(b[n]).equals(disk), `${n}.bin diffère de la reconstruction`);
  }
  assert.ok(ms < 20000, `construction trop lente : ${ms.toFixed(0)} ms`);
});

test('maxima 10 / 16 / 19 et part de gains KPK trait aux blancs 76,5 %', () => {
  const T = tb.tables, max = a => a.reduce((m, v) => (v !== 255 && v > m ? v : m), 0);
  assert.equal(max(T.KQK), 10);
  assert.equal(max(T.KRK), 16);
  assert.equal(max(T.KPK), 19);
  let n = 0, w = 0;
  for (const v of T.KPK) if (v !== 255) { n++; if (v) w++; }
  assert.ok(Math.abs(100 * w / n - 76.5) <= 0.1, `part de gains ${(100 * w / n).toFixed(3)} %`);
  // Sans pion, le camp fort au trait gagne toujours.
  for (const k of ['KQK', 'KRK']) assert.ok(!T[k].includes(0), `${k} : nulle trait au fort`);
});

test('tbFromBytes : tailles vérifiées, table absente → null', () => {
  assert.throws(() => tbFromBytes({ kqk: new Uint8Array(10) }));
  const only = tbFromBytes({ kqk: tb.tables.KQK });
  assert.equal(only.probe('8/8/8/4k3/8/8/1P6/K7 w - - 0 1'), null);
  assert.deepEqual(only.probe('k7/8/1Q6/8/8/8/8/7K w - - 0 1'), tb.probe('k7/8/1Q6/8/8/8/8/7K w - - 0 1'));
});

// ---------- signature / probe ----------
test('signature', () => {
  assert.deepEqual(tb.signature('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'), { sig: 'KPK', strong: 'w' });
  assert.deepEqual(tb.signature('4k3/8/8/8/8/8/4q3/4K3 b - - 0 1'), { sig: 'KQK', strong: 'b' });
  assert.deepEqual(tb.signature('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'), { sig: 'KRK', strong: 'w' });
  for (const f of ['4k3/8/8/8/8/8/8/4K3 w - - 0 1', '4k3/8/8/8/8/8/3PP3/4K3 w - - 0 1', '4k3/8/8/8/8/8/4B3/4K3 w - - 0 1',
    '4k3/8/8/8/8/8/3pP3/4K3 w - - 0 1', '4K3/8/8/8/8/8/4P3/3K4 w - - 0 1', '8/8/8/8/8/8/4P3/4K3 w - - 0 1'])
    assert.equal(tb.signature(f), null, f);
});

test('probe : positions illégales → null', () => {
  for (const f of [
    '4k3/4Q3/8/8/8/8/8/4K3 w - - 0 1',   // roi noir en échec, trait aux blancs
    '8/8/8/8/8/8/3kP3/4K3 w - - 0 1',    // rois au contact
    '8/8/8/8/8/8/3kP3/4K3 b - - 0 1',
    '4k3/8/8/8/8/8/8/P3K3 w - - 0 1',    // pion sur la 1re rangée
    'P3k3/8/8/8/8/8/8/4K3 b - - 0 1',
    '4k3/8/8/8/8/8/4q3/4K3 b - - 0 1',   // roi blanc en échec, trait aux noirs (camp fort noir)
  ]) {
    assert.equal(tb.probe(f), null, f);
    assert.deepEqual(tb.rankMoves(f), [], f);
  }
});

test('positions connues', () => {
  const P = (fen, win, dist) => {
    const p = tb.probe(fen);
    assert.ok(p, fen);
    assert.equal(p.win, win, `${fen} : gain`);
    if (dist !== undefined) assert.equal(p.dist, dist, `${fen} : distance`);
    return p;
  };
  // Roi sur la 6e devant son pion : gagné quel que soit le trait.
  P('4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', true, 5);
  P('4k3/8/4K3/4P3/8/8/8/8 b - - 0 1', true, 4);
  // Roi derrière son pion de 5e, défenseur devant : 1…Re7 (ou 1.Rd5 Rd7) tient l'opposition, nulle des deux côtés.
  P('4k3/8/8/4P3/4K3/8/8/8 b - - 0 1', false);
  P('4k3/8/8/4P3/4K3/8/8/8 w - - 0 1', false);
  // Opposition : roi blanc devant le pion, trait aux noirs → gagné ; trait aux blancs → nulle.
  P('4k3/8/4K3/8/4P3/8/8/8 w - - 0 1', true);
  P('4k3/8/8/4K3/4P3/8/8/8 w - - 0 1', true);   // 1.Re6 : case clé
  P('4k3/8/8/4K3/4P3/8/8/8 b - - 0 1', false);  // 1…Re7 : opposition, trait aux blancs
  P('8/4k3/8/4K3/4P3/8/8/8 w - - 0 1', false);  // opposition directe, trait aux blancs
  P('8/4k3/8/4K3/4P3/8/8/8 b - - 0 1', true);
  // Pion de la tour : le roi noir dans le coin annule.
  P('7k/8/6K1/7P/8/8/8/8 w - - 0 1', false);
  P('k7/8/8/P7/1K6/8/8/8 w - - 0 1', false);
  P('k7/8/1K6/P7/8/8/8/8 b - - 0 1', false);
  P('7K/7P/5k2/8/8/8/8/8 b - - 0 1', false);    // 1…Rf7 enferme le roi blanc : pat
  P('7K/7P/5k2/8/8/8/8/8 w - - 0 1', true);     // 1.Rg8 puis h8=D
  P('8/8/8/8/8/1k6/p7/K7 w - - 0 1', false);    // pat
  assert.deepEqual(tb.rankMoves('8/8/8/8/8/1k6/p7/K7 w - - 0 1'), []);
  // Mats : Tc3/Rd3 contre Rd1 → mat en 2 ; position matée → dist 0 ; pat → nulle.
  P('8/8/8/8/8/2RK4/8/3k4 w - - 0 1', true, 2);
  P('R2k4/8/3K4/8/8/8/8/8 b - - 0 1', true, 0);
  P('k7/8/1Q6/8/8/8/8/7K b - - 0 1', false);
  // Couleurs inversées.
  P('8/8/8/8/8/2rk4/8/3K4 b - - 0 1', true, 2);
  P('8/8/8/8/8/8/4p3/4k1K1 b - - 0 1', true, 2);
  // Dame en prise, défenseur au trait : nulle (il la prend).
  P('k7/1Q6/8/8/8/8/8/7K b - - 0 1', false);
});

test('KPK : la dame fait pat, la promotion en tour gagne', () => {
  const fen = '8/k1P5/8/K7/8/8/8/8 w - - 0 1';
  const p = tb.probe(fen);
  assert.equal(p.win, true);
  assert.equal(p.dist, 1);
  const rm = tb.rankMoves(fen), by = u => rm.find(m => m.uci === u);
  assert.deepEqual(rm.filter(m => m.win).map(m => m.uci), ['c7c8r']);
  assert.equal(by('c7c8q').win, false);
  assert.equal(by('c7c8r').dist, 0);
  assert.equal(by('c7c8r').sig, 'KRK');
  assert.ok(by('c7c8r').mateDist > 0);
  assert.equal(by('c7c8b').win, false);
  assert.equal(rm[0].uci, 'c7c8r');
  const c = new Chess(fen); c.move('c8=Q');
  assert.ok(c.isStalemate());
  assert.equal(tb.probe(c.fen()).win, false);
  // Même chose côté noir.
  const s = swapColors(fen);
  assert.deepEqual(tb.rankMoves(s).filter(m => m.win).map(m => m.uci), ['c2c1r']);
  assert.equal(tb.trap(s, Math.random), 'c2c1r');
});

// ---------- Propriétés sur positions aléatoires ----------
for (const sig of ['KQK', 'KRK', 'KPK']) {
  test(`${sig} : légalité, mat/pat et symétries sur ${N_SYM} positions`, t => {
    const rng = mulberry32(sig.charCodeAt(1) * 7919);
    let checked = 0, illegal = 0, mates = 0, pats = 0;
    while (checked < N_SYM) {
      const fen = randomFen(rng, sig), p = tb.probe(fen);
      if (!legalFen(fen)) { illegal++; assert.equal(p, null, `illégale mais sondée : ${fen}`); continue; }
      assert.ok(p, `légale mais refusée : ${fen}`);
      assert.equal(p.sig, sig);
      assert.equal(p.mate, sig !== 'KPK');
      assert.equal(p.dist === null, !p.win, fen);
      const c = new Chess(fen);
      if (c.isCheckmate()) { mates++; assert.ok(p.win && p.dist === 0, `mat non vu : ${fen}`); }
      else assert.ok(!(p.win && p.dist === 0), `mat imaginaire : ${fen}`);
      if (c.isStalemate()) { pats++; assert.equal(p.win, false, `pat compté gagné : ${fen}`); }
      assert.deepEqual(tb.probe(mirrorFiles(fen)), p, `miroir : ${fen}`);
      const s = tb.probe(swapColors(fen));
      assert.deepEqual({ ...s, strong: flip(s.strong) }, p, `couleurs : ${fen}`);
      checked++;
    }
    assert.ok(illegal > 0);
    t.diagnostic(`${sig} : ${checked} légales, ${illegal} illégales, ${mates} mats, ${pats} pats`);
  });

  test(`${sig} : rankMoves = coups légaux de chess.js, chacun évalué par probe (${N_GEN} positions)`, () => {
    const rng = mulberry32(sig.charCodeAt(1) * 104729);
    const c = new Chess();
    for (let i = 0; i < N_GEN; i++) {
      let fen;
      do fen = randomFen(rng, sig); while (!legalFen(fen));
      c.load(fen);
      const ref = c.moves({ verbose: true });
      const rm = tb.rankMoves(fen);
      assert.deepEqual(rm.map(m => m.uci).sort(), ref.map(m => m.from + m.to + (m.promotion || '')).sort(), fen);
      for (const m of rm) {
        const r = ref.find(x => x.from + x.to + (x.promotion || '') === m.uci);
        assert.equal(m.capture, !!r.captured, `${fen} ${m.uci} : prise`);
        assert.equal(m.promo, r.promotion || null);
        c.move(r);
        const after = c.fen(), p = tb.probe(after);
        c.undo();
        if (m.capture || m.promo === 'b' || m.promo === 'n') { assert.equal(p, null); assert.ok(!m.win && m.dist === null, `${fen} ${m.uci}`); continue; }
        assert.ok(p, `${fen} ${m.uci} : position obtenue non sondée`);
        assert.equal(m.win, p.win, `${fen} ${m.uci} : gain`);
        if (m.promo) { assert.equal(m.dist, p.win ? 0 : null); assert.equal(m.mateDist, p.dist); }
        else assert.equal(m.dist, p.dist, `${fen} ${m.uci} : distance`);
        if (new Chess(after).isCheckmate()) assert.ok(m.win && m.dist === 0, `${fen} ${m.uci} : mat`);
      }
      // Tri : le meilleur coup du camp au trait d'abord.
      const p = tb.probe(fen), strongToMove = fen.split(' ')[1] === p.strong;
      if (rm.length && strongToMove && p.win) assert.equal(rm[0].dist, Math.min(...rm.filter(m => m.win).map(m => m.dist)));
      if (rm.length && !strongToMove && p.win) assert.equal(rm[0].dist, p.dist);
      if (rm.length && !strongToMove && !p.win) assert.equal(rm[0].win, false);
    }
  });
}

// Équations de Bellman sur toutes les entrées des fichiers : gain à v ⇔ meilleur coup à v − 1, et la meilleure
// défense revient à v − 1 ; nulle ⇔ aucun coup gagnant.
test('cohérence des distances sur toutes les entrées des tables', () => {
  const step = QUICK ? 7 : 1;
  let n = 0;
  const check = (fen, v) => {
    const rm = tb.rankMoves(fen), wins = rm.filter(m => m.win);
    if (!v) { assert.equal(wins.length, 0, `nulle mais coup gagnant : ${fen}`); return; }
    const best = Math.min(...wins.map(m => m.dist));
    assert.equal(best, v - 1, `${fen} : meilleur coup à ${best} au lieu de ${v - 1}`);
    const p = tb.probe(fen);
    assert.ok(p.win && p.dist === v);
    if (v > 1 && n % 13 === 0) { // la meilleure défense revient à v − 1
      const c = new Chess(fen); c.move(toMove(wins.find(m => m.dist === v - 1).uci));
      const def = tb.rankMoves(c.fen());
      assert.equal(def[0].dist, v - 1, `${c.fen()} : défense`);
    }
    n++;
  };
  for (const sig of ['KQK', 'KRK']) {
    const T = tb.tables[sig];
    for (let i = 0; i < T.length; i += step) {
      if (T[i] === 255) continue;
      const wk = TRI[i >> 12], bk = (i >> 6) & 63, x = i & 63;
      check(fenOf([[wk, 'K'], [bk, 'k'], [x, PIECE[sig]]], 'w'), T[i]);
    }
  }
  const T = tb.tables.KPK;
  for (let i = 0; i < T.length; i += step) {
    if (T[i] === 255) continue;
    const wk = (i / 1536) | 0, bk = ((i / 24) | 0) & 63, r = ((i % 24) >> 2) + 1, f = i & 3;
    check(fenOf([[wk, 'K'], [bk, 'k'], [r * 8 + f, 'P']], 'w'), T[i]);
  }
  assert.ok(n > (QUICK ? 10000 : 100000));
});

// ---------- Politiques ----------
test('stubborn : prend la pièce en prise, sinon le plus long, puis le moins de réponses gagnantes', () => {
  assert.equal(tb.stubborn('k7/1Q6/8/8/8/8/8/7K b - - 0 1', Math.random), 'a8b7');
  assert.equal(tb.stubborn('8/8/8/8/8/8/1Pk5/7K b - - 0 1', Math.random), 'c2b2');
  assert.equal(tb.stubborn('k7/8/1Q6/8/8/8/8/7K b - - 0 1', Math.random), null); // pat : aucun coup
  const rng = mulberry32(42), c = new Chess();
  let ties = 0;
  for (const sig of ['KQK', 'KRK', 'KPK']) for (let i = 0; i < (QUICK ? 60 : 300); i++) {
    let fen, p;
    do { fen = randomFen(rng, sig); p = legalFen(fen) && tb.probe(fen); } while (!p || fen.split(' ')[1] === p.strong || !p.win || p.dist === 0);
    const mv = tb.stubborn(fen, rng), rm = tb.rankMoves(fen);
    assert.equal(tb.rankMoves(fen).find(m => m.uci === mv).dist, p.dist, `${fen} : ${mv} n'est pas la défense la plus longue`);
    const longest = rm.filter(m => m.dist === p.dist);
    if (longest.length > 1) {
      ties++;
      const winning = u => { c.load(fen); c.move(toMove(u)); return tb.rankMoves(c.fen()).filter(m => m.win).length; };
      assert.equal(winning(mv), Math.min(...longest.map(m => winning(m.uci))), `${fen} : départage`);
    }
    // Même hasard → même coup.
    const s = Math.floor(rng() * 1e9);
    assert.equal(tb.stubborn(fen, mulberry32(s)), tb.stubborn(fen, mulberry32(s)));
  }
  assert.ok(ties > 0);
});

test('trap : gain le plus court, sinon garde le pion et laisse le moins de réponses annulantes', () => {
  assert.equal(tb.trap('8/8/8/8/8/2RK4/8/3k4 w - - 0 1', Math.random), 'd3e3');
  const rng = mulberry32(7), c = new Chess();
  let draws = 0, forced = 0;
  for (let i = 0; i < (QUICK ? 150 : 600); i++) {
    let fen, p;
    do { fen = randomFen(rng, 'KPK'); p = legalFen(fen) && tb.probe(fen); } while (!p || fen.split(' ')[1] !== p.strong);
    c.load(fen);
    if (c.isGameOver()) continue;
    const mv = tb.trap(fen, rng), rm = tb.rankMoves(fen);
    if (p.win) { assert.equal(rm.find(m => m.uci === mv).dist, p.dist - 1, `${fen} : ${mv}`); continue; }
    draws++;
    // Réponses annulantes de l'utilisateur après chaque coup ; « lâcher » = prise possible, pat ou sous-promotion F/C.
    const info = u => {
      c.load(fen); c.move(toMove(u));
      const opp = c.moves({ verbose: true });
      const dead = /[bn]$/.test(u) || c.isStalemate(); // partie finie (pat, finale morte) : le pire des pièges
      return { gives: dead || opp.some(m => m.captured), drawing: dead ? Infinity : tb.rankMoves(c.fen()).filter(m => !m.win).length };
    };
    const all = rm.map(m => ({ u: m.uci, ...info(m.uci) })), safe = all.filter(m => !m.gives), pool = safe.length ? safe : all;
    if (!safe.length) forced++;
    const got = all.find(m => m.u === mv);
    assert.ok(pool.includes(got), `${fen} : ${mv} lâche le pion`);
    assert.equal(got.drawing, Math.min(...pool.map(m => m.drawing)), `${fen} : ${mv} laisse trop de réponses`);
  }
  assert.ok(draws > 10);
});

test('têtu contre piégeur : la partie dure exactement la distance de la table', () => {
  const rng = mulberry32(2024), c = new Chess();
  for (const sig of ['KQK', 'KRK', 'KPK']) for (let i = 0; i < N_PLAY; i++) {
    let fen, p;
    do { fen = randomFen(rng, sig); p = legalFen(fen) && tb.probe(fen); } while (!p || !p.win);
    c.load(fen);
    let strongMoves = 0, done = false;
    for (let ply = 0; ply < 80 && !done; ply++) {
      const strong = c.turn() === p.strong;
      const mv = strong ? tb.trap(c.fen(), rng) : tb.stubborn(c.fen(), rng);
      assert.ok(mv, `${fen} : aucun coup en ${c.fen()}`);
      c.move(toMove(mv));
      if (strong) strongMoves++;
      if (sig === 'KPK' && mv.length === 5) { done = true; assert.ok(tb.probe(c.fen()).win, `${fen} : promotion perdue`); }
      if (c.isCheckmate()) done = true;
      assert.ok(!c.isStalemate() && !c.isInsufficientMaterial(), `${fen} : gain perdu en ${c.fen()}`);
    }
    assert.ok(done, `${fen} : pas de fin`);
    assert.equal(strongMoves, p.dist, `${fen} : ${strongMoves} coups au lieu de ${p.dist}`);
  }
});

test('vitesse : probe < 0,05 ms, rankMoves < 2 ms', () => {
  const rng = mulberry32(5), fens = [];
  for (const sig of ['KQK', 'KRK', 'KPK']) for (let i = 0; i < 200; i++) { const f = randomFen(rng, sig); if (legalFen(f)) fens.push(f); }
  let t = performance.now(), n = 0;
  for (let k = 0; k < 50; k++) for (const f of fens) { tb.probe(f); n++; }
  const probeMs = (performance.now() - t) / n;
  t = performance.now(); n = 0;
  for (let k = 0; k < 5; k++) for (const f of fens) { tb.rankMoves(f); n++; }
  const rankMs = (performance.now() - t) / n;
  assert.ok(probeMs < 0.05, `probe ${probeMs.toFixed(4)} ms`);
  assert.ok(rankMs < 2, `rankMoves ${rankMs.toFixed(3)} ms`);
});

// ---------- Contre-vérification par Stockfish ----------
// Gain de la table ⇒ moteur ≥ +300 (camp fort) à 300 ms ; nulle ⇒ ≤ +100 ; mat annoncé ⇒ jamais plus court que la table.
// Un désaccord est revu à 3000 ms ; ceux qui persistent font échouer le test, tous sont détaillés.
let engine = null;
after(() => engine && engine.close());
test(`moteur : ${N_ENG} positions`, { timeout: 600000 }, async t => {
  engine = nodeEngine();
  const rng = mulberry32(QUICK ? 99 : 1234), c = new Chess();
  const mix = { KPK: Math.round(N_ENG * 0.6), KQK: Math.round(N_ENG * 0.2) };
  mix.KRK = N_ENG - mix.KPK - mix.KQK;
  const score = async (fen, p, movetime) => {
    await engine.newGame?.();
    const [l] = await engine.analyse(fen, { movetime });
    const sgn = fen.split(' ')[1] === p.strong ? 1 : -1;
    return { cp: sgn * l.cp, mate: l.mate == null ? null : sgn * l.mate };
  };
  const bad = (p, e) => (p.win ? e.cp < 300 || (p.mate && e.mate > 0 && e.mate < p.dist) : e.cp > 100);
  const report = [], stats = { win: 0, draw: 0 };
  for (const [sig, n] of Object.entries(mix)) for (let i = 0; i < n; i++) {
    let fen, p;
    do { fen = randomFen(rng, sig); p = legalFen(fen) && (c.load(fen), !c.isGameOver()) && tb.probe(fen); } while (!p);
    stats[p.win ? 'win' : 'draw']++;
    const e = await score(fen, p, 300);
    if (!bad(p, e)) continue;
    const e2 = await score(fen, p, 3000);
    report.push({ fen, table: p.win ? `gain en ${p.dist}` : 'nulle', ms300: e, ms3000: e2, persists: bad(p, e2) });
  }
  t.diagnostic(`positions : ${stats.win} gains, ${stats.draw} nulles ; désaccords à 300 ms : ${report.length}`);
  for (const r of report) t.diagnostic(`${r.fen} | table ${r.table} | 300 ms ${JSON.stringify(r.ms300)} | 3000 ms ${JSON.stringify(r.ms3000)}${r.persists ? ' | PERSISTE' : ''}`);
  const persist = report.filter(r => r.persists);
  assert.equal(persist.length, 0, 'désaccords persistants :\n' + persist.map(r => JSON.stringify(r)).join('\n'));
  assert.ok(report.length <= Math.max(2, N_ENG * 0.05), `trop de désaccords à 300 ms (${report.length})`);
});
