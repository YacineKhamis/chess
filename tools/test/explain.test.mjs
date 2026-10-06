// Explicateur à base de règles (js/explain/*) — spec §6.2 item 6.
// node --test tools/test/explain.test.mjs   (QUICK=1 : échantillons réduits ; FULL=1 : 1 000 positions par famille)
//
// Chaque énoncé est revérifié ici par un calcul indépendant (chess.js, tables exactes, Stockfish pour KRRK) :
// boîte, mat, pat, sauvetage, distances, mat après chaque réponse, pièce perdue. Plus : invariance des étiquettes par
// miroir et échange des couleurs, hygiène du texte, niveau 1 sans le coup, taux de repli et temps de calcul.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../../vendor/chess.js';
import { explainMove, explainMistake, pickTeachingMove, FAMILIES, stats } from '../../js/explain/index.js';
import { mirrorFiles, swapColors } from '../../js/analysis.js';
import { mirrorSq, mulberry32 } from '../../js/drill/geom.js';
import { randomMatePosition } from '../../js/drills/mats.js';
import { DRILLS } from '../../js/drills/index.js';
import { produce } from '../../js/drill/produce.js';
import { Attempt } from '../../js/drill/attempt.js';
import { loadTBFromFs } from './tb-fs.mjs';
import { nodeEngine } from './node-engine.mjs';
import { N, QUICK } from './harness.mjs';

let tb, engine;
before(async () => { tb = await loadTBFromFs(); });
after(() => { if (engine) engine.close(); });
const getEngine = async () => { if (!engine) { engine = nodeEngine(); await engine.ready; } return engine; };

// ---------- Outils indépendants (chess.js) ----------
const SQS = [...'abcdefgh'].flatMap(f => [...'12345678'].map(r => f + r));
const fileOf = s => s.charCodeAt(0) - 97, rankOf = s => +s[1] - 1;
const cheb = (a, b) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
const near = s => SQS.filter(t => t !== s && cheb(s, t) === 1);
const toMove = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
const after1 = (fen, u) => { const c = new Chess(fen); c.move(toMove(u)); return c; };
const kingSq = (c, col) => SQS.find(s => { const p = c.get(s); return p && p.type === 'k' && p.color === col; });
// Boîte (spec F2) recalculée avec chess.js : les deux rois retirés, attaques de nos autres pièces, toutes les pièces sont des murs.
function boxSize(fen, def) {
  const c = new Chess(fen, { skipValidation: true }), us = def === 'w' ? 'b' : 'w';
  const K = kingSq(c, def), Ku = kingSq(c, us);
  c.remove(K); if (Ku) c.remove(Ku);
  const zone = new Set([K]), todo = [K];
  while (todo.length) {
    const s = todo.pop();
    for (const t of near(s)) {
      if (zone.has(t) || c.isAttacked(t, us) || c.get(t)) continue;
      zone.add(t); todo.push(t);
    }
  }
  return zone.size;
}
const hasMate1 = c => c.moves({ verbose: true }).some(m => { c.move(m); const k = c.isCheckmate(); c.undo(); return k; });
const mapUci = (u, f) => f(u.slice(0, 2)) + f(u.slice(2, 4)) + u.slice(4);
// Échange des couleurs = symétrie haut-bas (comme analysis.swapColors). NB : geom.flipSq donne e1 → e7 (bogue signalé).
const flipSq = sq => sq[0] + (9 - +sq[1]);

// ---------- Hygiène du texte ----------
const plain = s => String(s).replace(/\*\*/g, '').replace(/\u00a0/g, ' ');
const sentencesOf = lines => plain(lines.join(' ')).split(/(?<=[.!?])[\s ]+(?=[A-ZÀÂÉÈÊÎÔÛÇ«])/).filter(x => x.trim());
// Explications de coup : ≤ 2 phrases et ≤ 180 caractères en tout. Erreurs (perLine) : ≤ 180 caractères par ligne.
function checkText(lines, where, { max = 2, level = 3, perLine = false } = {}) {
  assert.ok(Array.isArray(lines) && lines.length >= 1, `${where} : texte vide`);
  for (const l of lines) {
    assert.equal(typeof l, 'string', where);
    assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b|\[object/.test(l), `${where} : « ${l} »`);
    assert.ok(!/\b1 cases\b|\b0 cases?\b|\bplus que 1 case/.test(l), `${where} : accord « ${l} »`);
    assert.ok(!/ {2}|  |  |  /.test(l), `${where} : espaces doubles « ${l} »`);
    assert.ok(!/ [?!:;]/.test(l), `${where} : espace insécable manquante « ${l} »`);
    assert.ok((l.match(/\*\*/g) || []).length % 2 === 0, `${where} : gras non fermé « ${l} »`);
  }
  const ss = sentencesOf(lines);
  assert.ok(ss.length <= max, `${where} : ${ss.length} phrases « ${lines.join(' / ')} »`);
  for (const s of ss) assert.ok(level < 3 ? /[.!?]$/.test(s.trim()) : /[.!]$/.test(s.trim()), `${where} : fin de phrase « ${s} »`);
  for (const chunk of perLine ? lines : [lines.join(' ')])
    if (level === 3) assert.ok(plain(chunk).length <= 180, `${where} : trop long (${plain(chunk).length}) « ${lines.join(' / ')} »`);
}

// ---------- Vérification indépendante d'une explication ----------
function verify(fen, move, e, where) {
  const before = new Chess(fen), us = before.turn(), def = us === 'w' ? 'b' : 'w';
  const c = after1(fen, move), fenA = c.fen();
  const tags = e.tags;
  checkText(e.text, where);
  // mat / pat
  assert.equal(tags.includes('mate'), c.isCheckmate(), `${where} : mat ${tags}`);
  if (c.isCheckmate()) assert.equal(e.debug.primary, 'mate', `${where} : un mat doit être annoncé comme tel`);
  assert.ok(!c.isStalemate(), `${where} : coup pat expliqué comme bon`);
  if (tags.includes('stalemate-danger')) {
    const ms = c.moves({ verbose: true });
    assert.ok(!c.isCheck() && ms.length >= 1 && ms.length <= 2 && ms.every(m => m.piece === 'k'), `${where} : danger de pat faux`);
    for (const m of ms) assert.ok(e.text.join(' ').includes(m.to), `${where} : case ${m.to} absente`);
  }
  // boîte : jamais « resserre » si elle ne rétrécit pas ; les nombres annoncés sont les vrais
  if (tags.includes('box-shrink')) {
    const a = boxSize(fen, def), b = boxSize(fenA, def);
    assert.ok(b < a, `${where} : boîte ${a} → ${b} annoncée en baisse`);
    assert.ok(plain(e.text[0]).includes(`de ${a} à ${b} case`), `${where} : nombres ${a} → ${b} « ${e.text[0]} »`);
  }
  // sauvetage : plus aucune prise possible après le coup
  if (tags.includes('rescue')) assert.ok(!c.moves({ verbose: true }).some(m => m.captured), `${where} : sauvetage avec une prise encore possible`);
  // distances annoncées
  const d = plain(e.text.join(' ')).match(/distance (\d) → (\d)/);
  if (d) {
    const K = kingSq(before, def), m = toMove(move);
    assert.deepEqual([+d[1], +d[2]], [cheb(m.from, K), cheb(m.to, K)], `${where} : distance`);
  }
  // mat après chaque réponse
  if (tags.includes('mate-every-reply')) {
    for (const r of c.moves({ verbose: true })) { c.move(r); assert.ok(hasMate1(c), `${where} : ${r.san} n’est pas suivi d’un mat`); c.undo(); }
  }
  // échec annoncé
  if (tags.includes('driving-check') || tags.includes('ladder') || tags.includes('opposition-check')) assert.ok(c.isCheck(), `${where} : échec annoncé`);
  // visuels : cases valides, ≤ 2 flèches, ≤ 6 marques
  const v = e.viz || {};
  for (const s of [...(v.zone || []), ...Object.keys(v.marks || {}), ...(v.arrows || []).flatMap(a => [a.from, a.to])]) assert.ok(SQS.includes(s), `${where} : case ${s}`);
  assert.ok((v.arrows || []).length <= 2 && Object.keys(v.marks || {}).length <= 6, `${where} : trop de visuels`);
}
// Niveau 1 : ni le coup, ni sa case d'arrivée, ni flèche.
function verifyLevel1(fen, move, e1, where) {
  checkText(e1.text, where, { level: 1 });
  const to = move.slice(2, 4);
  const san = after1(fen, move).history().at(-1);
  const txt = plain(e1.idea + ' ' + e1.text.join(' '));
  assert.ok(!new RegExp(`\\b${to}\\b`).test(txt), `${where} : la case ${to} est révélée « ${txt} »`);
  assert.ok(!txt.includes(san.replace(/[+#]/g, '')), `${where} : le coup est révélé « ${txt} »`);
  assert.ok(!(e1.viz?.arrows || []).length, `${where} : flèche au niveau 1`);
  assert.ok(!(e1.viz?.marks || {})[to], `${where} : marque sur la case d’arrivée`);
}

// =====================================================================================================
// 1. Fixtures du §6.2-6
// =====================================================================================================
test('fixtures §6.2-6 (KRK, KQK)', () => {
  // Rh5 : fuite préventive (le roi menaçait Rb4), pas « boîte resserrée » (la boîte passe de 8 à 28 cases).
  let e = explainMove({ fen: '8/8/8/2R5/k7/8/8/5K2 w - - 0 1', move: 'c5h5', family: 'krk', tb });
  assert.equal(e.debug.primary, 'preemptive-flee', e.text.join(' '));
  assert.ok(!e.tags.includes('box-shrink'));
  assert.match(plain(e.text[0]), /Rb4.*5e rangée/);
  // Re3 : mat après chaque réponse (seule réponse Re1, puis Tc1#).
  e = explainMove({ fen: '8/8/8/8/8/2RK4/8/3k4 w - - 0 1', move: 'd3e3', family: 'krk', tb });
  assert.equal(e.debug.primary, 'mate-every-reply', e.text.join(' '));
  assert.match(plain(e.text[0]), /Re1.*Tc1/);
  // Rf3 : la cage explose (6 → 44) mais la boîte ne bouge pas (14 → 14) : jamais « box-grow ».
  // Correction de la fixture : la recherche annonçait 16 → 16 ; la boîte vaut 14 → 14, et Rf3 n'est pas le meilleur
  // coup (mat en 9 au lieu de 7 après Te3) : c'est donc un coup « plus lent », sans reproche sur la boîte.
  const f3 = '8/8/8/8/8/R7/3k1K2/8 w - - 0 1';
  assert.equal(boxSize(f3, 'b'), 14);
  assert.equal(boxSize(after1(f3, 'f2f3').fen(), 'b'), 14);
  e = explainMove({ fen: f3, move: 'f2f3', family: 'krk', tb });
  assert.ok(!e.tags.includes('box-shrink') && !e.tags.includes('box-grow'), e.tags.join());
  const best = tb.rankMoves(f3)[0].uci;
  assert.equal(best, 'a3e3');
  const m = explainMistake({ fen: f3, userMove: 'f2f3', bestMove: best, family: 'krk', tb });
  assert.equal(m.severity, 'slow');
  assert.ok(!m.tags.includes('box-grow'), m.tags.join());
  assert.match(plain(m.text[0]), /mat en 9 au lieu de 7/);
  // Dg4 : saut de cavalier, la boîte passe de 20 à 15 cases.
  e = explainMove({ fen: '8/8/8/6Q1/3K4/8/5k2/8 w - - 0 1', move: 'g5g4', family: 'kqk', tb });
  assert.ok(e.tags.includes('box-shrink'), e.tags.join());
  assert.match(plain(e.text[0]), /de 20 à 15 cases/);
  verify('8/8/8/6Q1/3K4/8/5k2/8 w - - 0 1', 'g5g4', e, 'Dg4');
});

// Détail et vérifications indépendantes : tools/test/explain-endgames.test.mjs.
test('fixtures §6.2-6 des finales avec pion : pont de Lucena, 3e rangée de Philidor, case clé KPK', () => {
  let e = explainMove({ fen: '3K4/3P4/6k1/8/8/8/2r5/4R3 w - - 0 1', move: 'e1e4', family: 'lucena' });
  assert.equal(e.debug.primary, 'lucena-bridge', e.text.join(' '));
  assert.match(plain(e.text[0]), /Tu construis le pont : ta tour se place sur la 4e rangée/);
  e = explainMove({ fen: '3k4/R7/8/1KP2r2/8/8/8/8 b - - 0 1', move: 'f5f6', family: 'philidor' });
  assert.equal(e.debug.primary, 'philidor-third', e.text.join(' '));
  assert.match(plain(e.text[0]), /ta tour garde la 6e rangée \(ta 3e\)/);
  e = explainMove({ fen: '8/8/8/5k2/8/4K3/4P3/8 w - - 0 1', move: 'e3d4', family: 'kpk', tb });
  assert.equal(e.debug.primary, 'key-square', e.text.join(' '));
  assert.match(plain(e.text[0]), /case clé d4/);
});

// =====================================================================================================
// 2. Motifs tactiques, images de mat, vigilance
// =====================================================================================================
const TACTICS = [
  { name: 'fourchette', fen: '8/2p5/2P5/5r1N/1p1K4/1P6/4k3/8 w - - 0 1', move: 'h5g3', family: 'tactic:fork', id: 'fork', re: /Fourchette.*roi en e2.*tour noire en f5/, tag: 'gain' },
  { name: 'enfilade', fen: '2q5/2k5/8/5p2/5Pp1/4R1P1/8/4K3 w - - 0 1', move: 'e3c3', family: 'tactic:skewer', id: 'skewer', re: /Enfilade.*dame noire/, tag: 'gain' },
  { name: 'clouage', fen: 'n7/8/4k3/3n4/p1B4p/p3P2P/P4K2/6N1 w - - 0 1', move: 'e3e4', family: 'tactic:pin', id: 'pin', re: /Clouage : le cavalier noir ne peut pas bouger.*e4/, tag: 'gain' },
  { name: 'pièce en prise', fen: '8/1p2k3/1P6/1N3p2/5P2/2r5/7K/8 w - - 0 1', move: 'b5c3', family: 'tactic:hanging', id: 'hanging-take', re: /tour noire n’était pas protégée/ },
  { name: 'parer le couloir (air)', fen: 'k7/1p6/4r3/8/5R2/8/5PPP/6K1 w - - 0 1', move: 'h2h4', family: 'parry', id: 'parry-threat', re: /menaçaient Te1 mat : tu donnes de l’air à ton roi/, tag: 'luft' },
  { name: 'parer le couloir (garde)', fen: 'k7/1p6/4r3/8/5R2/8/5PPP/6K1 w - - 0 1', move: 'f4e4', family: 'parry', id: 'parry-threat', re: /menaçaient Te1 mat : tu bloques la ligne/ },
  { name: 'mat du couloir', fen: '1k6/ppp5/8/8/8/8/2PP3R/3K4 w - - 0 1', move: 'h2h8', family: 'mate-pic', id: 'mate', re: /mat du couloir/, tag: 'mate-couloir' },
  { name: 'mat à l’étouffée', fen: '6nk/6pp/8/6N1/8/2K5/8/8 w - - 0 1', move: 'g5f7', family: 'mate-pic', id: 'mate', re: /étouffée/, tag: 'mate-etouffe' },
  { name: 'batterie dame-fou', fen: '1kr5/1pp5/8/8/3Q4/8/1PPP4/2K3B1 w - - 0 1', move: 'd4a7', family: 'mate-pic', id: 'mate', re: /protégée par ton fou/, tag: 'mate-batterie' },
  { name: 'mat en deux (sacrifice)', fen: '2r4k/6pp/7N/pp6/8/1Q6/1PPP4/2K5 w - - 0 1', move: 'b3g8', family: 'mate-pic', id: 'mate-every-reply', re: /plus qu’un coup, Txg8, et Cf7 sera mat/ },
];
for (const T of TACTICS) {
  test(`motif : ${T.name}`, () => {
    const e = explainMove({ fen: T.fen, move: T.move, family: T.family });
    assert.equal(e.debug.primary, T.id, e.text.join(' '));
    assert.match(plain(e.text.join(' ')), T.re);
    if (T.tag) assert.ok(e.tags.includes(T.tag), e.tags.join());
    verify(T.fen, T.move, e, T.name);
    const e1 = explainMove({ fen: T.fen, move: T.move, family: T.family, level: 1 });
    verifyLevel1(T.fen, T.move, e1, T.name);
    // invariance
    for (const [fx, f] of [['miroir', mirrorFiles], ['couleurs', swapColors]]) {
      const sq = fx === 'miroir' ? mirrorSq : flipSq;
      const e2 = explainMove({ fen: f(T.fen), move: mapUci(T.move, sq), family: T.family });
      assert.deepEqual(e2.tags, e.tags, `${T.name} ${fx}`);
    }
  });
}
test('motifs : un échec ne « pare » pas une menace de mat, il la retarde', () => {
  const e = explainMove({ fen: 'k7/1p6/4r3/8/5R2/8/5PPP/6K1 w - - 0 1', move: 'f4f8', family: 'parry' });
  assert.notEqual(e.debug.primary, 'parry-threat', e.text.join(' '));
});
test('erreurs tactiques : menace ignorée, pièce perdue, motif manqué', () => {
  const P = 'k7/1p6/4r3/8/5R2/8/5PPP/6K1 w - - 0 1';
  let m = explainMistake({ fen: P, userMove: 'f4f5', bestMove: 'h2h4', family: 'parry' });
  assert.ok(m.tags.includes('allows-mate') && m.tags.includes('threat-ignored'), m.tags.join());
  assert.match(plain(m.text[0]), /menaçaient Te1 mat, et ton coup ne pare pas la menace/);
  assert.match(plain(m.text[1]), /^Mieux : h4\./);
  m = explainMistake({ fen: '8/2p5/2P5/5r1N/1p1K4/1P6/4k3/8 w - - 0 1', userMove: 'h5f6', bestMove: 'h5g3', family: 'tactic:fork' });
  assert.ok(m.tags.includes('piece-lost'), m.tags.join());
  assert.match(plain(m.text[0]), /Ton cavalier se met en prise : la tour noire le prend en f6/);
  // le cavalier h5 est déjà attaqué par la tour f5 : tout autre coup le laisse en prise
  m = explainMistake({ fen: '8/2p5/2P5/5r1N/1p1K4/1P6/4k3/8 w - - 0 1', userMove: 'd4c4', bestMove: 'h5g3', family: 'tactic:fork' });
  assert.match(plain(m.text[0]), /Ton cavalier reste en prise : la tour noire le prend en h5/);
  m = explainMistake({ fen: '2q5/2k5/8/5p2/5Pp1/4R1P1/8/4K3 w - - 0 1', userMove: 'e1d2', bestMove: 'e3c3', family: 'tactic:skewer' });
  assert.ok(m.tags.includes('missed-motif'), m.tags.join());
  assert.match(plain(m.text[0]), /Tu laisses passer une enfilade/);
  m = explainMistake({ fen: '1k6/ppp5/8/8/8/8/2PP3R/3K4 w - - 0 1', userMove: 'h2h7', bestMove: 'h2h8', family: 'mate-pic' });
  assert.ok(m.tags.includes('missed-mate'), m.tags.join());
  assert.equal(m.text.length, 1);
  checkText(m.text, 'erreur', { max: 3, perLine: true });
});

// =====================================================================================================
// 3. Propriétés sur des positions au hasard (tables exactes : KQK, KRK)
// =====================================================================================================
const play = (fen, u) => after1(fen, u).fen();
// Position de technique : tirage du générateur des exercices, puis 0 à 7 coups parfaits des deux côtés.
function technique(rng, piece, { pawns = false } = {}) {
  for (;;) {
    const c = randomMatePosition(rng, [piece], { bkPred: () => true });
    if (!c) continue;
    let fen = c.fen, lastMove = null;
    if (!tb.probe(fen)?.win) continue;
    const steps = Math.floor(rng() * 8);
    let ok = true;
    for (let k = 0; k < steps && ok; k++) {
      const r = tb.rankMoves(fen);
      const best = r.filter(x => x.win && x.dist === r[0].dist);
      if (!best.length || r[0].dist === 0) { ok = false; break; }
      fen = play(fen, best[Math.floor(rng() * best.length)].uci);
      const s = tb.stubborn(fen, rng);
      if (!s) { ok = false; break; }
      lastMove = s; fen = play(fen, s);
    }
    if (ok && tb.probe(fen)?.win) return { fen, lastMove };
  }
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const report = {};

for (const [family, piece] of [['kqk', 'Q'], ['krk', 'R']]) {
  test(`propriétés ${family.toUpperCase()} : ${N(100, 300, 1000)} positions × coup pédagogique (tables exactes)`, () => {
    const rng = mulberry32(family === 'kqk' ? 101 : 202);
    const n = N(100, 300, 1000), times = [], ids = {};
    const ideas = DRILLS[family === 'kqk' ? 'mat-dame' : 'mat-tour'].ideas;
    for (let i = 0; i < n; i++) {
      const { fen, lastMove } = technique(rng, piece);
      const r = tb.rankMoves(fen);
      const cands = r.filter(x => x.win && x.dist === r[0].dist).map(x => x.uci);
      const t0 = performance.now();
      const move = pickTeachingMove({ fen, family, ideas, candidates: cands, tb, lastMove });
      const e1 = explainMove({ fen, move, family, ideas, lastMove, tb, level: 1 });
      const e = explainMove({ fen, move, family, ideas, lastMove, tb, level: 3 });
      times.push(performance.now() - t0);
      assert.ok(cands.includes(move));
      const where = `${family} ${fen} ${move}`;
      verify(fen, move, e, where);
      verifyLevel1(fen, move, e1, where);
      ids[e.debug.primary || 'fallback'] = (ids[e.debug.primary || 'fallback'] || 0) + 1;
      // invariance par miroir et échange des couleurs (dernier coup adverse transformé aussi)
      for (const [fx, f, sq] of [['miroir', mirrorFiles, mirrorSq], ['couleurs', swapColors, flipSq]]) {
        const e2 = explainMove({ fen: f(fen), move: mapUci(move, sq), family, ideas, lastMove: lastMove && mapUci(lastMove, sq), tb });
        assert.deepEqual(e2.tags, e.tags, `${where} ${fx} : ${e2.text} | ${e.text}`);
      }
    }
    const fb = (ids.fallback || 0) / n, look = (ids.lookahead || 0) / n;
    report[family] = { n, fallback: fb, lookahead: look, median: median(times), ids };
    assert.ok(fb < 0.15, `${family} : taux de repli ${(fb * 100).toFixed(1)} %`);
    assert.ok(median(times) < 20, `${family} : médiane ${median(times).toFixed(2)} ms`);
  });
}

// =====================================================================================================
// 4. KRRK (Stockfish) et mats avec pions bloqués (moteur)
// =====================================================================================================
async function engineFamily(id, n, seed) {
  const eng = await getEngine();
  const spec = DRILLS[id], rng = mulberry32(seed), times = [], ids = {};
  let done = 0;
  for (let i = 0; done < n && i < n * 20; i++) {
    const c = spec.generate(rng, Math.floor(rng() * spec.levels.length));
    if (!c) continue;
    await eng.newGame();
    let fen = c.fen, lastMove = null;
    for (let k = Math.floor(rng() * 5); k > 0; k--) {
      const [l] = await eng.analyse(fen, { movetime: 40 });
      if (!l || !l.move) break;
      const ch = after1(fen, l.move);
      if (ch.isGameOver()) break;
      const [r] = await eng.analyse(ch.fen(), { movetime: 40 });
      if (!r || !r.move) break;
      ch.move(toMove(r.move));
      if (ch.isGameOver()) break;
      fen = ch.fen(); lastMove = r.move;
    }
    const lines = await eng.analyse(fen, { movetime: 150, multipv: 3 });
    if (!lines.length || lines[0].cp < 300) continue;
    const b = lines[0];
    const good = lines.filter(l => (b.mate != null ? l.mate === b.mate : l.mate == null && b.cp - l.cp <= 15));
    const t0 = performance.now();
    const move = pickTeachingMove({ fen, family: spec.family, ideas: spec.ideas, candidates: good.map(l => l.move), lastMove });
    const pv = good.find(l => l.move === move).pv;
    const e1 = explainMove({ fen, move, family: spec.family, ideas: spec.ideas, pv, lastMove, level: 1 });
    const e = explainMove({ fen, move, family: spec.family, ideas: spec.ideas, pv, lastMove, level: 3 });
    times.push(performance.now() - t0);
    const where = `${id} ${fen} ${move}`;
    verify(fen, move, e, where);
    verifyLevel1(fen, move, e1, where);
    for (const [fx, f, sq] of [['miroir', mirrorFiles, mirrorSq], ['couleurs', swapColors, flipSq]]) {
      const e2 = explainMove({ fen: f(fen), move: mapUci(move, sq), family: spec.family, ideas: spec.ideas, pv: pv.map(u => mapUci(u, sq)), lastMove: lastMove && mapUci(lastMove, sq) });
      assert.deepEqual(e2.tags, e.tags, `${where} ${fx}`);
    }
    ids[e.debug.primary || 'fallback'] = (ids[e.debug.primary || 'fallback'] || 0) + 1;
    done++;
  }
  assert.ok(done >= n * 0.8, `${id} : ${done} positions seulement`);
  const fb = (ids.fallback || 0) / done;
  report[id] = { n: done, fallback: fb, lookahead: (ids.lookahead || 0) / done, median: median(times), ids };
  return { fb, med: median(times) };
}
test(`propriétés KRRK : ${N(40, 300, 1000)} positions × coup du moteur (MultiPV 3)`, { timeout: 30 * 60e3 }, async () => {
  const { fb, med } = await engineFamily('mat-deux-tours', N(40, 300, 1000), 303);
  assert.ok(fb < 0.15, `KRRK : taux de repli ${(fb * 100).toFixed(1)} %`);
  assert.ok(med < 20, `KRRK : médiane ${med.toFixed(2)} ms`);
});
for (const id of ['mat-dame-pions', 'mat-tour-pions']) {
  test(`propriétés ${id} (pions bloqués) : ${N(20, 100, 300)} positions`, { timeout: 30 * 60e3 }, async () => {
    const { fb, med } = await engineFamily(id, N(20, 100, 300), id.length * 31);
    assert.ok(fb < 0.2, `${id} : taux de repli ${(fb * 100).toFixed(1)} %`);
    assert.ok(med < 20, `${id} : médiane ${med.toFixed(2)} ms`);
  });
}

// Les nombres des raisons d'erreur sont revérifiés (boîte, distance, cases du pat).
function verifyReasons(fen, u, m, where) {
  const before = new Chess(fen), def = before.turn() === 'w' ? 'b' : 'w', c = after1(fen, u), t = plain(m.text[0]);
  if (m.tags.includes('box-grow')) {
    const a = boxSize(fen, def), b = boxSize(c.fen(), def);
    assert.ok(b > a && t.includes(`de ${a} à ${b} case`), `${where} : ${t}`);
  }
  if (m.tags.includes('king-away')) {
    const K = kingSq(before, def), mv = toMove(u);
    assert.ok(t.includes(`distance ${cheb(mv.from, K)} → ${cheb(mv.to, K)}`) && cheb(mv.to, K) > cheb(mv.from, K), `${where} : ${t}`);
  }
  if (m.tags.includes('useless-check')) {
    assert.ok(c.isCheck(), where);
    const rep = t.match(/après (\S+),/)[1], c2 = new Chess(c.fen());
    c2.move(rep.replace(/^R/, 'K').replace(/^D/, 'Q').replace(/^T/, 'R'));
    const after2 = boxSize(c2.fen(), def), a = boxSize(fen, def);
    assert.ok(after2 >= a && t.includes(`${after2} case`), `${where} : ${t}`);
  }
  if (m.tags.includes('stalemate-risk')) {
    const ms = c.moves({ verbose: true });
    assert.ok(!c.isCheck() && ms.length <= 2 && ms.every(x => t.includes(x.to)), `${where} : ${t}`);
  }
  if (m.tags.includes('cut-lost')) assert.match(t, /ne coupe plus le roi (noir|blanc) sur (la colonne [a-h]|la \d(re|e) rangée)/, where);
}

// Positions des exercices tactiques produites par produce() (moteur) : le coup clé reçoit une explication précise.
const TACTIC_DRILLS = {
  'piece-en-prise': ['hanging-take', 'see-gain'], 'fourchette-cavalier': ['fork'], enfilade: ['skewer'], clouage: ['pin'],
  'mat-couloir': ['mate', 'mate-every-reply', 'lookahead'], 'mat-etouffe': ['mate', 'mate-every-reply', 'lookahead'],
  'mat-dame-fou': ['mate'], 'parer-couloir': ['parry-threat'],
};
test(`exercices tactiques : ${N(2, 8, 30)} positions par exercice, coup clé expliqué par son motif`, { timeout: 30 * 60e3 }, async () => {
  const eng = await getEngine();
  const ctx = { engine: eng, tb: null, rng: mulberry32(77) };
  let all = 0, allHit = 0;
  for (const [id, motifs] of Object.entries(TACTIC_DRILLS)) {
    const spec = DRILLS[id];
    if (!spec) continue;
    const n = N(2, 8, 30), ids = {};
    let done = 0, hit = 0;
    for (let i = 0; i < n; i++) {
      const s = await produce(spec, i % spec.levels.length, ctx);
      if (!s) continue;
      const key = s.key || (s.pv && s.pv[0]);
      if (!key) continue;
      const pv = s.pv && s.pv[0] && s.pv[0].slice(0, 4) === key.slice(0, 4) ? s.pv : [key];
      const e = explainMove({ fen: s.fen, move: key, family: spec.family, ideas: spec.ideas, pv });
      const e1 = explainMove({ fen: s.fen, move: key, family: spec.family, ideas: spec.ideas, pv, level: 1 });
      verify(s.fen, key, e, `${id} ${s.fen} ${key}`);
      verifyLevel1(s.fen, key, e1, `${id} ${s.fen} ${key}`);
      const p = e.debug.primary || 'fallback';
      ids[p] = (ids[p] || 0) + 1;
      done++;
      if (motifs.includes(p)) hit++;
    }
    report[id] = { n: done, motif: done ? hit / done : null, fallback: done ? (ids.fallback || 0) / done : null, ids };
    assert.ok(!done || (ids.fallback || 0) / done <= 0.2, `${id} : replis ${JSON.stringify(ids)}`);
    all += done; allHit += hit;
  }
  // Le motif n'est pas toujours annoncé : « gratuitement » exige un gain confirmé par la variante (une prise peut
  // tomber dans une fourchette adverse), et un échec intermédiaire n'est pas une parade.
  assert.ok(all > 0 && allHit / all >= 0.8, `motif reconnu ${allHit}/${all}`);
});

// =====================================================================================================
// 5. Erreurs : gain → nulle en KRK/KQK, et jamais de reproche pour un coup aussi bon
// =====================================================================================================
for (const [family, piece] of [['kqk', 'Q'], ['krk', 'R']]) {
  test(`erreurs ${family.toUpperCase()} : raison précise pour ≥ 80 % des coups qui lâchent le gain`, () => {
    const rng = mulberry32(family === 'kqk' ? 7 : 8);
    let blunders = 0, specific = 0, sames = 0;
    const need = N(40, 150, 500);
    for (let i = 0; blunders < need && i < need * 200; i++) {
      const { fen } = technique(rng, piece);
      const r = tb.rankMoves(fen);
      const u = r[Math.floor(rng() * r.length)];
      const best = pickTeachingMove({ fen, family, candidates: r.filter(x => x.win && x.dist === r[0].dist).map(x => x.uci), tb });
      const m = explainMistake({ fen, userMove: u.uci, bestMove: best, family, tb });
      const where = `${family} ${fen} U=${u.uci}`;
      checkText(m.text, where, { max: 4, perLine: true });
      if (u.win && u.dist === r[0].dist) {
        sames++;
        assert.equal(m.severity, 'same', where);
        assert.deepEqual(m.text, ['Ton coup est aussi bon.'], where);
        continue;
      }
      verifyReasons(fen, u.uci, m, where);
      if (u.win) { assert.equal(m.severity, 'slow', where); assert.match(plain(m.text[0]), new RegExp(`mat en ${u.dist + 1} au lieu de ${r[0].dist + 1}`)); continue; }
      blunders++;
      assert.equal(m.severity, 'win-draw', where);
      if (!m.tags.includes('generic')) specific++;
      const c = after1(fen, u.uci);
      if (m.tags.includes('stalemate')) assert.ok(c.isStalemate(), where);
      if (m.tags.includes('piece-lost')) {
        const sq = Object.keys(m.viz.marks || {})[0];
        assert.ok(c.moves({ verbose: true }).some(x => x.to === sq && x.captured), `${where} : prise en ${sq} impossible`);
      }
      if (!m.tags.includes('missed-mate')) assert.match(plain(m.text.at(-1)), /^Mieux : /, where);
    }
    assert.ok(sames > 0);
    report[`erreurs ${family}`] = { blunders, specific: specific / blunders };
    assert.ok(specific / blunders >= 0.8, `${family} : ${specific}/${blunders} raisons précises`);
  });
}

// =====================================================================================================
// 6. Robustesse, greffons, famille générique
// =====================================================================================================
test('ne lève jamais d’exception : entrées absurdes → phrase générique honnête', () => {
  for (const args of [undefined, {}, { fen: 'n’importe quoi', move: 'e2e4' }, { fen: '8/8/8/8/8/8/8/8 w - - 0 1', move: 'a1a2' },
    { fen: '8/8/8/2R5/k7/8/8/5K2 w - - 0 1', move: 'c5c9' }, { fen: '8/8/8/2R5/k7/8/8/5K2 w - - 0 1', move: 'c5h5', family: 'inconnue', level: 1 }]) {
    const e = explainMove(args);
    assert.ok(e && Array.isArray(e.text) && e.text.length && typeof e.idea === 'string');
    checkText(e.text, JSON.stringify(args), { level: (args && args.level) || 3 });
    const m = explainMistake(args && { ...args, userMove: args.move });
    assert.ok(m && Array.isArray(m.text) && m.text.length);
  }
  assert.equal(pickTeachingMove({ fen: 'x', candidates: ['e2e4', 'd2d4'] }), 'e2e4');
  assert.equal(pickTeachingMove({ candidates: [] }), null);
  assert.equal(stats.errors, 0, String(stats.last && stats.last.stack));
});
test('greffons : toutes les familles du catalogue ont une définition, la générique couvre le reste', () => {
  for (const id of ['kqk', 'krk', 'krrk', 'tactic:hanging', 'tactic:fork', 'tactic:skewer', 'tactic:pin', 'mate-pic', 'parry', '*'])
    assert.ok(FAMILIES[id], id);
  for (const f of Object.values(FAMILIES)) for (const r of [...f.rules, ...f.warnings]) assert.ok(typeof r !== 'string' || r, f.id);
  // famille inconnue (finales de pions en attendant leur greffon) : des faits vrais et prudents seulement
  const e = explainMove({ fen: '8/8/8/8/2k5/8/4P3/4K3 w - - 0 1', move: 'e2e4', family: 'kpk' });
  checkText(e.text, 'kpk');
  assert.ok(['passed-push', 'fallback', 'lookahead'].includes(e.debug.primary || 'fallback'), e.tags.join());
});

// =====================================================================================================
// 7. Intégration : Attempt (indice 1→3, « Pourquoi ? ») sur une position de mat-dame produite par produce()
// =====================================================================================================
test('intégration Attempt : indices 1 à 3 puis « Pourquoi ? » sur une position KQK produite par produce()', async () => {
  const ctx = { engine: null, tb, rng: mulberry32(55) };
  const spec = DRILLS['mat-dame'];
  const start = await produce(spec, 2, ctx);
  assert.ok(start && start.fen);
  const a = new Attempt(spec, start, ctx);
  const fen = a.fen;
  const r1 = await a.hint(), r2 = await a.hint(), r3 = await a.hint();
  assert.deepEqual([r1.step, r2.step, r3.step], [1, 2, 3]);
  assert.equal(r1.move, r3.move);
  const ranked = tb.rankMoves(fen);
  assert.ok(ranked.filter(x => x.win && x.dist === ranked[0].dist).some(x => x.uci === r1.move), 'indice = un des meilleurs coups');
  verifyLevel1(fen, r1.move, r1, 'indice 1');
  verifyLevel1(fen, r2.move, r2, 'indice 2');
  assert.ok(r1.idea.length > 5);
  verify(fen, r3.move, r3, 'indice 3');
  assert.ok(a.hints === 3 && a.hintMax === 3);
  // erreur : un coup qui lâche le gain (dame en prise ou pat), puis « Pourquoi ? »
  const bad = ranked.find(x => !x.win);
  assert.ok(bad, 'aucun coup perdant dans cette position');
  const res = await a.userMove(bad.uci);
  assert.equal(res.status, 'end');
  assert.equal(a.outcome.status, 'fail');
  const w = await a.why();
  assert.ok(w && w.fen === fen && w.userMove === bad.uci);
  assert.equal(w.severity, 'win-draw');
  assert.ok(w.tags.includes('piece-lost') || w.tags.includes('stalemate'), w.tags.join());
  assert.match(plain(w.text.at(-1)), /^Mieux : /);
  checkText(w.text, 'pourquoi', { max: 4, perLine: true });
});

after(() => {
  if (process.env.EXPLAIN_REPORT || !QUICK) {
    for (const [k, v] of Object.entries(report)) console.log(`# ${k} : ${JSON.stringify(v)}`);
  }
});
