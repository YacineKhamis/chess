// Explicateur des finales avec pion (js/explain/families/{eg,kpk,kpk-def,kqkp,krkp,rooks}.js) — spec §5.2–§5.4.
// node --test tools/test/explain-endgames.test.mjs   (QUICK=1 : échantillons réduits, < 2 min ; FULL=1 : gros échantillons)
//
// Chaque phrase est revérifiée ici par un calcul indépendant : chess.js pour la géométrie et les coups légaux, les tables
// exactes pour chaque « gagné », « nulle », « ira à dame », « N coups au plus ». Positions : les vrais générateurs
// (produce() avec les spécifications des exercices), puis la partie jouée par l'oracle (tables, ou Stockfish ~300 ms).
// Plus : niveau 1 sans le coup, hygiène du texte, invariance par miroir et échange des couleurs, taux de repli, temps,
// raisons d'erreur (opposition laissée, pion poussé trop tôt, carré), intégration Attempt (indices 1→3 et « Pourquoi ? »).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../../vendor/chess.js';
import { explainMove, explainMistake, pickTeachingMove, FAMILIES, stats } from '../../js/explain/index.js';
import { mirrorFiles, swapColors } from '../../js/analysis.js';
import { mirrorSq, mulberry32 } from '../../js/drill/geom.js';
import { nullMoveFen, fr } from '../../js/util.js';
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

// =====================================================================================================
// Outils indépendants (chess.js) — aucune fonction de js/explain n'est réutilisée ici
// =====================================================================================================
const SQS = [...'abcdefgh'].flatMap(f => [...'12345678'].map(r => f + r));
const fileOf = s => s.charCodeAt(0) - 97, rankOf = s => +s[1] - 1;
const sq = (f, r) => (f >= 0 && f < 8 && r >= 0 && r < 8 ? 'abcdefgh'[f] + (r + 1) : null);
const cheb = (a, b) => Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
const near = s => SQS.filter(t => t !== s && cheb(s, t) === 1);
const other = c => (c === 'w' ? 'b' : 'w');
const toMove = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || 'q' });
const after1 = (fen, u) => { const c = new Chess(fen); c.move(toMove(u)); return c; };
const kingSq = (c, col) => SQS.find(s => { const p = c.get(s); return p && p.type === 'k' && p.color === col; });
const pieces = (c, col) => SQS.filter(s => { const p = c.get(s); return p && p.color === col; }).map(s => ({ s, ...c.get(s) }));
const pawnOf = c => { const ps = SQS.filter(s => c.get(s)?.type === 'p'); return ps.length === 1 ? { sq: ps[0], color: c.get(ps[0]).color } : null; };
const rel = (s, col) => (col === 'w' ? rankOf(s) : 7 - rankOf(s));
const promoOf = P => sq(fileOf(P.sq), P.color === 'w' ? 7 : 0);
const toPromote = P => 7 - rel(P.sq, P.color) - (rel(P.sq, P.color) === 1 ? 1 : 0);   // double pas compté
const onlyKings = c => SQS.every(s => !c.get(s) || c.get(s).type === 'k');
const enSan = s => s.replace(/^[RDTFC]/, x => ({ R: 'K', D: 'Q', T: 'R', F: 'B', C: 'N' }[x])).replace(/=([DTFC])/, (_, x) => '=' + ({ D: 'Q', T: 'R', F: 'B', C: 'N' }[x]));
const plain = s => String(s).replace(/\*\*/g, '').replace(/ /g, ' ');
const mapUci = (u, f) => f(u.slice(0, 2)) + f(u.slice(2, 4)) + u.slice(4);
const flipSq = s => s[0] + (9 - +s[1]);
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
const probe = fen => tb.probe(fen);
const winFor = (fen, col) => { const p = probe(fen); return !!p && p.win && p.strong === col; };
const drawn = fen => { const p = probe(fen); return !!p && !p.win; };

// Opposition (indépendante) : même ligne, nombre impair de cases entre les rois ; ou diagonale, une case entre (ou 3, 5).
function opp(a, b) {
  const df = Math.abs(fileOf(a) - fileOf(b)), dr = Math.abs(rankOf(a) - rankOf(b));
  if ((df === 0 && dr === 2) || (dr === 0 && df === 2)) return 'direct';
  if ((df === 0 && dr >= 4 && dr % 2 === 0) || (dr === 0 && df >= 4 && df % 2 === 0)) return 'distant';
  if (df === dr && df % 2 === 0 && df > 0) return 'diagonal';
  return null;
}
// Cases clés (définition des manuels, réécrite ici)
function keys(P) {
  const f = fileOf(P.sq), r = rel(P.sq, P.color), out = [];
  const add = (ff, rr) => { const s = sq(ff, P.color === 'w' ? rr : 7 - rr); if (s) out.push(s); };
  if (f === 0 || f === 7) { add(f === 0 ? 1 : 6, 6); add(f === 0 ? 1 : 6, 7); return out; }
  if (r >= 1 && r <= 3) for (const d of [-1, 0, 1]) add(f + d, r + 2);
  else if (r >= 4 && r <= 5) for (const rr of [r + 1, r + 2]) for (const d of [-1, 0, 1]) add(f + d, rr);
  return out;
}
// Chemin du roi `col` jusqu'à une case cible, en évitant les cases occupées et attaquées par l'autre camp.
function steps(c, from, col, targets) {
  if (!targets.length) return Infinity;
  const g = new Chess(c.fen(), { skipValidation: true });
  g.remove(from);
  const seen = new Set([from]);
  let front = [from], d = 0;
  while (front.length) {
    d++;
    const next = [];
    for (const s of front) for (const t of near(s)) {
      if (seen.has(t) || g.get(t) || g.isAttacked(t, other(col))) continue;
      if (targets.includes(t)) return d;
      seen.add(t); next.push(t);
    }
    front = next;
  }
  return Infinity;
}
// Cases devant le pion (libres, non attaquées par son camp)
function blockSqs(c, P) {
  const out = [], f = fileOf(P.sq);
  for (let r = rel(P.sq, P.color) + 1; r <= 7; r++) {
    const s = sq(f, P.color === 'w' ? r : 7 - r);
    if (!c.get(s) && !c.isAttacked(s, P.color)) out.push(s);
  }
  return out;
}
// Boîte (spec F2, comme explain.test.mjs) : rois retirés, nos autres pièces attaquent, toute pièce est un mur.
function boxSize(fen, def) {
  const c = new Chess(fen, { skipValidation: true }), us = other(def);
  const K = kingSq(c, def), Ku = kingSq(c, us);
  c.remove(K); if (Ku) c.remove(Ku);
  const zone = new Set([K]), todo = [K];
  while (todo.length) {
    const s = todo.pop();
    for (const t of near(s)) { if (zone.has(t) || c.isAttacked(t, us) || c.get(t)) continue; zone.add(t); todo.push(t); }
  }
  return zone.size;
}
// Zone réelle du roi `col` (il marche, nos pièces attaquent à travers sa case ; ses pièces sont des murs ; il peut prendre
// une pièce adverse non défendue — on s'arrête dessus).
function kingRegion(fen, col, withCaptures = true) {
  const c = new Chess(fen, { skipValidation: true }), K = kingSq(c, col);
  c.remove(K);
  const zone = new Set([K]), todo = [K];
  while (todo.length) {
    const s = todo.pop();
    for (const t of near(s)) {
      if (zone.has(t)) continue;
      const p = c.get(t);
      if (p && p.color === col) continue;
      if (c.isAttacked(t, other(col)) || (p && !withCaptures)) continue;
      zone.add(t); if (!p) todo.push(t);
    }
  }
  return zone;
}
// Prises du pion (ou de la pièce promue sur `target`) sans perte de la pièce qui prend, ni pat.
function punishes(c2, target) {
  for (const x of c2.moves({ verbose: true })) {
    if (x.to !== target || !x.captured) continue;
    c2.move(x);
    const ok = !c2.isStalemate() && !c2.moves({ verbose: true }).some(y => y.to === x.to && y.captured);
    c2.undo();
    if (ok) return true;
  }
  return false;
}

// ---------- Hygiène du texte ----------
const sentencesOf = lines => plain(lines.join(' ')).split(/(?<=[.!?])\s+(?=[A-ZÀÂÉÈÊÎÔÛÇ«])/).filter(x => x.trim());
function checkText(lines, where, { max = 2, level = 3, perLine = false } = {}) {
  assert.ok(Array.isArray(lines) && lines.length >= 1, `${where} : texte vide`);
  for (const l of lines) {
    assert.equal(typeof l, 'string', where);
    assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b|\[object|Infinity/.test(l), `${where} : « ${l} »`);
    assert.ok(!/\b1 cases\b|\b0 cases?\b|\b1 coups\b|\bplus que 1 case|\b1e\b|\bde le\b|\bà le\b|\bde les\b|\bà les\b|\bau la\b|\bdu la\b/.test(plain(l)), `${where} : grammaire « ${l} »`);
    assert.ok(!/ {2}/.test(plain(l)), `${where} : espaces doubles « ${l} »`);
    assert.ok(!/ [?!:;]/.test(l), `${where} : espace insécable manquante « ${l} »`);
    assert.ok(!/[.!?] +(?![a-h][1-8x=])[a-zà-ü]/.test(plain(l)), `${where} : majuscule manquante « ${l} »`);
    assert.ok((l.match(/\*\*/g) || []).length % 2 === 0, `${where} : gras non fermé « ${l} »`);
    assert.ok(!/'/.test(l), `${where} : apostrophe droite « ${l} »`);
  }
  const ss = sentencesOf(lines);
  assert.ok(ss.length <= max, `${where} : ${ss.length} phrases « ${lines.join(' / ')} »`);
  for (const s of ss) assert.ok(level < 3 ? /[.!?]$/.test(s.trim()) : /[.!]$/.test(s.trim()), `${where} : fin de phrase « ${s} »`);
  for (const chunk of perLine ? lines : [lines.join(' ')])
    if (level === 3) assert.ok(plain(chunk).length <= 180, `${where} : trop long (${plain(chunk).length}) « ${lines.join(' / ')} »`);
}
// Niveau 1 : ni le coup, ni sa case d'arrivée, ni flèche, ni marque sur la case d'arrivée.
function verifyLevel1(fen, move, e1, where) {
  checkText(e1.text, where, { level: 1 });
  const to = move.slice(2, 4), san = after1(fen, move).history().at(-1).replace(/[+#]/g, '');
  const txt = plain(e1.idea + ' ' + e1.text.join(' '));
  assert.ok(!new RegExp(`\\b${to}\\b`).test(txt), `${where} : la case ${to} est révélée « ${txt} »`);
  assert.ok(!txt.includes(san) && !txt.includes(san.replace(/^[KQRBN]/, x => ({ K: 'R', Q: 'D', R: 'T', B: 'F', N: 'C' }[x]))), `${where} : le coup est révélé « ${txt} »`);
  assert.ok(!(e1.viz?.arrows || []).length, `${where} : flèche au niveau 1`);
  assert.ok(!(e1.viz?.marks || {})[to], `${where} : marque sur la case d’arrivée`);
}

// =====================================================================================================
// Vérification indépendante d'une explication (chaque étiquette, chaque nombre, chaque mot fort)
// =====================================================================================================
function verify(fen, move, e, where, { lastMove = null } = {}) {
  checkText(e.text, where);
  const B = new Chess(fen), us = B.turn(), them = other(us), A = after1(fen, move), fenA = A.fen();
  const mvB = B.moves({ verbose: true }).find(m => m.from === move.slice(0, 2) && m.to === move.slice(2, 4) && (!m.promotion || m.promotion === (move[4] || 'q')));
  const tags = e.tags, txt = plain(e.text.join(' ')), P = pawnOf(B), PA = pawnOf(A);
  const Ku = kingSq(A, us), Kt = kingSq(A, them), Ku0 = kingSq(B, us);
  const replies = A.moves({ verbose: true });
  const pA = probe(fenA);
  const has = t => tags.includes(t);
  const fail = msg => assert.fail(`${where} : ${msg} « ${txt} » [${tags}]`);
  const ok = (cond, msg) => { if (!cond) fail(msg); };
  ok(!A.isStalemate() || has('stalemate-save'), 'pat non annoncé');
  if (has('stalemate-save')) ok(A.isStalemate(), 'pas pat');

  // ---- Mots forts : tables ou position ----
  if (/c’est nulle/.test(txt)) ok(A.isStalemate() || onlyKings(A) || (pA && !pA.win), '« nulle » non confirmée');
  if (/c’est gagné/.test(txt)) ok(pA && pA.win && pA.strong === us, '« gagné » non confirmé');
  if (/ira à dame|sera promu|promotion est assurée|quoi que joue/.test(txt)) ok(pA && pA.win && pA.strong === us, 'promotion non confirmée par les tables');
  const cnt = txt.match(/promu en (\d+) coups? au plus/);
  if (cnt) ok(pA && pA.win && pA.dist === +cnt[1], `compte ${cnt[1]} ≠ ${pA && pA.dist}`);
  if (/ne peut plus l’arrêter|ne peut pas l’arrêter|ne peut plus le rattraper/.test(txt)) ok(pA && pA.win && pA.strong === us, 'arrêt du pion non confirmé');
  if (/arrivera à temps/.test(txt)) ok(pA && !pA.win, '« à temps » non confirmé');
  const dist = txt.match(/distance (\d) → (\d)/);
  if (dist) {
    const d = has('king-first') ? (s => Math.min(...keys(P).map(k => cheb(s, k))))
      : (s => cheb(s, has('pawn-approach') || has('chase') ? P.sq : kingSq(B, them)));
    ok(+dist[1] === d(move.slice(0, 2)) && +dist[2] === d(move.slice(2, 4)) && +dist[2] < +dist[1], 'distance');
  }
  const between = txt.match(/(\d) cases entre les rois/);
  if (between) ok(+between[1] === cheb(Ku, Kt) - 1 && +between[1] % 2 === 1 && (fileOf(Ku) === fileOf(Kt) || rankOf(Ku) === rankOf(Kt)), 'cases entre les rois');
  if (/c’est (maintenant )?au roi (blanc|noir) de jouer/.test(txt)) ok(A.turn() === them && txt.includes(`au roi ${them === 'w' ? 'blanc' : 'noir'} de jouer`), 'trait');
  const one = txt.match(/n’a qu’un coup, (\S+?),/);
  if (one) { ok(replies.length === 1 && replies[0].san === enSan(one[1]), 'un seul coup'); }
  if (/plus aucun échec/.test(txt)) ok(!replies.some(r => { A.move(r); const k = A.isCheck(); A.undo(); return k; }), 'un échec reste possible');
  if (/menace d’aller à dame/.test(txt)) {
    const nl = new Chess(nullMoveFen(fenA)), Pn = pawnOf(nl);
    const pr = nl.moves({ verbose: true }).find(m => m.piece === 'p' && m.promotion === 'q' && m.to === promoOf(Pn));
    ok(pr, 'pas de promotion possible');
    nl.move(pr);
    ok(!nl.moves({ verbose: true }).some(y => y.to === pr.to && y.captured), 'la dame promue serait prise');
  }
  const box = txt.match(/de (\d+) à (\d+) cases/);
  if (box && (has('box-shrink') || has('driving-check'))) ok(+box[1] === boxSize(fen, them), 'boîte avant');
  if (has('box-shrink')) ok(+box[2] === boxSize(fenA, them), 'boîte après');
  if (has('stalemate-danger')) ok(!A.isCheck() && replies.length <= 2 && replies.every(m => m.piece === 'k' && (!/Attention au pat :/.test(txt) || txt.includes(m.to))), 'danger de pat');

  // ---- Faits des finales de pions (tables) ----
  if (has('key-square')) {
    const K = keys(P);
    ok(K.includes(Ku) && !K.includes(Ku0) && txt.includes(`case clé ${Ku}`) && winFor(fenA, us), 'case clé');
  }
  if (has('opposition')) {
    const kind = opp(Ku, Kt);
    ok(kind && has('opposition-' + kind) && A.turn() === them, 'opposition');
    ok(P.color === us ? winFor(fenA, us) : drawn(fenA), 'opposition : tables');
    if (/céder le passage à ton roi/.test(txt)) for (const r of replies) {
      A.move(r);
      const fwd = A.moves({ verbose: true }).some(m => m.piece === 'k' && rel(m.to, P.color) > rel(Ku, P.color) && winFor(after1(A.fen(), m.from + m.to).fen(), us));
      A.undo();
      ok(fwd, `après ${r.san}, ton roi ne peut pas avancer`);
    }
    if (/ne peut pas avancer/.test(txt)) ok(!replies.some(r => r.piece === 'k' && rel(r.to, P.color) > rel(Kt, P.color)), 'le roi adverse peut avancer');
  }
  if (has('pawn-tempo')) ok(mvB.piece === 'p' && opp(Ku, Kt) && winFor(fenA, us), 'coup d’attente du pion');
  if (has('outflank')) {
    ok(lastMove && opp(Ku0, lastMove.slice(0, 2)) && !opp(Ku0, lastMove.slice(2, 4)) && rel(Ku, P.color) > rel(Ku0, P.color) && winFor(fenA, us), 'débordement');
    if (/de l’autre côté/.test(txt)) ok(Math.sign(fileOf(Ku) - fileOf(Ku0)) === -Math.sign(fileOf(lastMove.slice(2, 4)) - fileOf(lastMove.slice(0, 2))), 'côté');
  }
  if (has('shoulder')) {
    const a = steps(A, Kt, them, blockSqs(A, P)), b = steps(B, kingSq(B, them), them, blockSqs(B, P));
    const m = txt.match(/\((\d+) coups? au lieu de (\d+)\)/);
    ok(a > b && (m ? +m[1] === a && +m[2] === b : a === Infinity), `épaule ${a} / ${b}`);
  }
  if (has('king-in-front')) ok(Math.abs(fileOf(Ku) - fileOf(P.sq)) <= 1 && rel(Ku, P.color) > rel(P.sq, P.color) && winFor(fenA, us), 'roi devant');
  if (has('safe-push')) {
    ok(mvB.piece === 'p' && winFor(fenA, us), 'poussée');
    if (has('out-of-square')) ok(cheb(Kt, promoOf(PA)) > toPromote(PA) + 1, 'hors du carré');
    if (has('protected')) ok(cheb(Ku, PA.sq) === 1, 'protégé');
    if (has('key-held')) ok(keys(P).includes(Ku0), 'case clé tenue');
  }
  if (has('def-front')) ok(fileOf(Ku) === fileOf(P.sq) && rel(Ku, P.color) > rel(P.sq, P.color) && (!pA || !pA.win), 'devant le pion');
  if (has('def-straight')) {
    ok(fileOf(Ku0) === fileOf(P.sq) && fileOf(Ku) === fileOf(P.sq) && rel(Ku, P.color) > rel(Ku0, P.color) && (!pA || !pA.win), 'recul tout droit');
    if (/reprendre l’opposition/.test(txt)) {
      const adv = replies.filter(r => r.piece === 'k' && rel(r.to, P.color) > rel(Kt, P.color));
      ok(adv.length > 0, 'aucune avance adverse');
      for (const r of adv) {
        A.move(r);
        const back = A.moves({ verbose: true }).some(m => m.piece === 'k' && opp(m.to, r.to) === 'direct' && drawn(after1(A.fen(), m.from + m.to).fen()));
        A.undo();
        ok(back, `après ${r.san}, pas d’opposition`);
      }
    }
  }
  if (has('rook-pawn-corner')) {
    const f = fileOf(P.sq), g = f === 0 ? 1 : 6, Q = promoOf(P), Q7 = sq(f, P.color === 'w' ? 6 : 1), zone = [Q, sq(g, rankOf(Q)), Q7, sq(g, rankOf(Q7))];
    ok((f === 0 || f === 7) && drawn(fenA), 'coin : tables');
    if (/atteint le coin|reste dans le coin/.test(txt)) ok(zone.includes(Ku), 'pas dans le coin');
    else ok(cheb(Ku, Q) < cheb(Ku0, Q), 'ne va pas vers le coin');
  }
  if (has('lock-in')) ok(replies.filter(r => r.piece === 'k').every(r => fileOf(r.to) === fileOf(P.sq)) && drawn(fenA), 'roi enfermé');
  if (has('enter-square')) ok(cheb(Ku, promoOf(P)) <= toPromote(P) && drawn(fenA), 'carré');
  if (has('diagonal-walk')) ok(Math.abs(fileOf(Ku) - fileOf(Ku0)) === 1 && Math.abs(rankOf(Ku) - rankOf(Ku0)) === 1 && Math.abs(fileOf(Ku) - fileOf(P.sq)) < Math.abs(fileOf(Ku0) - fileOf(P.sq)) && cheb(Ku, promoOf(P)) < cheb(Ku0, promoOf(P)), 'diagonale');
  if (has('attack-pawn')) ok(cheb(Ku, P.sq) === 1 && cheb(Kt, P.sq) > 1 && drawn(fenA), 'attaque du pion');
  if (has('chase')) ok(drawn(fenA), 'rapprochement : tables');
  if (has('take-pawn')) ok(mvB.captured === 'p' && (onlyKings(A) || /une tour de chaque côté/.test(txt)), 'prise du pion');
  if (has('tb-count')) ok(!!cnt, 'compte absent');

  // ---- Dame contre pion ----
  if (has('in-front')) {
    const Q = promoOf(P), front = replies.filter(r => r.piece === 'k' && r.to === Q), where2 = txt.match(/se placer en ([a-h][1-8])/);
    ok(front.length === 1 && (!where2 || where2[1] === Q), 'devant son pion');
    for (const r of replies.filter(x => !(x.piece === 'k' && x.to === Q))) {
      A.move(r);
      const target = r.promotion ? r.to : r.piece === 'p' ? r.to : P.sq;
      const pun = punishes(A, target);
      A.undo();
      ok(pun, `après ${r.san}, le pion ne tombe pas`);
    }
  }
  if (has('pawn-pin')) {
    ok(!replies.some(r => r.piece === 'p'), 'le pion peut bouger');
    const c2 = new Chess(fenA, { skipValidation: true }); c2.remove(P.sq);
    ok(c2.isAttacked(Kt, us), 'pas de clouage');
  }
  if (has('king-first')) ok(!keys(P).includes(Ku) && !keys(P).includes(Ku0) && winFor(fenA, us), 'le roi d’abord');
  if (has('queen-attacks-pawn')) {
    ok(A.isAttacked(P.sq, us) && cheb(Kt, P.sq) > 1, 'pion non attaqué ou protégé');
    for (const r of replies) {
      A.move(r);
      const Pn = pawnOf(A), guard = Pn && Pn.color === them && cheb(kingSq(A, them), Pn.sq) <= 1;
      const pun = guard || punishes(A, (r.promotion || r.piece === 'p') ? r.to : P.sq);
      A.undo();
      ok(pun, `après ${r.san}, le pion ne tombe pas`);
    }
  }
  if (has('promo-watch')) {
    const promos = replies.filter(r => r.promotion);
    ok(promos.length > 0 && txt.includes(promoOf(P)), 'pas de promotion possible');
    for (const r of promos) { A.move(r); const pun = punishes(A, r.to); A.undo(); ok(pun, `après ${r.san}, la dame promue survit`); }
  }
  if (has('tempo-check')) ok(A.isCheck() && !replies.some(r => r.piece === 'p'), 'échec avec gain de temps');
  if (has('pawn-approach') && /bloque son propre pion/.test(txt)) ok(Kt === promoOf(P) && !replies.some(r => r.piece === 'p'), 'pion bloqué');
  if (has('pawn-approach') && /ne peut pas avancer pour l’instant/.test(txt)) ok(!replies.some(r => r.piece === 'p'), 'pion libre');
  if (has('win-pawn')) ok(mvB.captured === 'p' && pA && pA.win && pA.strong === us, 'prise du pion : tables');
  if (has('stalemate-defence')) {
    const caps = replies.filter(r => r.to === P.sq && r.captured && r.piece === 'q');
    ok(caps.length > 0, 'la dame ne peut pas prendre');
    for (const r of caps) { A.move(r); const st = A.isStalemate(); A.undo(); ok(st, `${r.san} ne fait pas pat`); }
  }
  if (has('corner-hide')) {
    const n = replies.filter(r => { A.move(r); const st = A.isStalemate(); A.undo(); return st; }).length;
    const m = txt.match(/(\d+) coups adverses feraient/);
    ok(Ku === promoOf(P) && (m ? +m[1] === n : /Un coup adverse/.test(txt) ? n === 1 : n === 0), `pat : ${n}`);
  }
  if (has('protect-pawn')) {
    ok(cheb(Ku, P.sq) === 1 && cheb(Kt, P.sq) > 1, 'roi près du pion');
    const hv = pieces(A, them).filter(x => x.type !== 'k');
    ok(hv.length === 1, 'une seule pièce adverse');
    const c2 = new Chess(fenA, { skipValidation: true }); c2.remove(hv[0].s); c2.remove(P.sq); c2.put({ type: hv[0].type, color: them }, P.sq);
    ok(!c2.isAttacked(P.sq, them), 'la reprise ne serait pas possible');
  }

  // ---- Tour contre pion ----
  if (has('pawn-cut')) {
    // « il ne peut pas franchir » : même en allant prendre une pièce, le roi reste de son côté ; sinon (« le long de »),
    // ses cases libres et non attaquées restent de son côté.
    const strict = /ne peut pas (la )?franchir/.test(txt) && !/tant qu’elle/.test(txt);
    const L = txt.match(/la colonne ([a-h])|la (\d)(?:re|e) rangée/), Z = kingRegion(fenA, them, strict);
    ok(L, 'ligne absente');
    const side = s => (L[1] ? Math.sign(fileOf(s) - fileOf(L[1] + '1')) : Math.sign(rankOf(s) - (+L[2] - 1)));
    const s0 = side(Kt);
    ok(L && s0 !== 0 && [...Z].every(s => side(s) === s0), 'coupure franchissable');
    if (/de son pion/.test(txt)) ok(side(P.sq) === -s0, 'le pion n’est pas de l’autre côté');
  }
  if (has('king-blocks')) ok(fileOf(Ku) === fileOf(P.sq) && rel(Ku, P.color) > rel(P.sq, P.color), 'roi devant le pion');
  if (has('rook-behind')) {
    const r = move.slice(2, 4);
    ok(fileOf(r) === fileOf(P.sq) && rel(r, P.color) < rel(P.sq, P.color) && A.isAttacked(P.sq, us), 'tour derrière');
  }
  if (has('rook-front')) ok(fileOf(move.slice(2, 4)) === fileOf(P.sq) && rel(move.slice(2, 4), P.color) > rel(P.sq, P.color) && txt.includes(promoOf(P)), 'tour devant');

  // ---- Lucena ----
  if (has('lucena-block')) {
    ok(B.isCheck(), 'pas d’échec à parer');
    if (/protégée par ton roi/.test(txt)) ok(cheb(Ku, move.slice(2, 4)) === 1, 'tour non protégée');
  }
  if (has('lucena-bridge')) {
    const r = move.slice(2, 4);
    ok(rel(r, us) === 3 && Ku === promoOf(P) && rel(P.sq, P.color) === 6 && txt.includes(`la ${rankOf(r) + 1}e rangée`), 'pont');
  }
  if (has('lucena-out')) {
    ok(Ku0 === promoOf(P) && fileOf(Ku) !== fileOf(P.sq) && !A.get(promoOf(P)), 'sortie du roi');
    if (/côté opposé/.test(txt)) ok(Math.sign(fileOf(Ku) - fileOf(P.sq)) === -Math.sign(fileOf(Kt) - fileOf(P.sq)), 'côté opposé');
  }
  if (has('lucena-cut')) {
    const x = fileOf(move.slice(2, 4)), a = fileOf(Kt), b = fileOf(P.sq);
    ok(Math.min(a, b) < x && x < Math.max(a, b) && !replies.some(r => r.piece === 'k' && fileOf(r.to) === x) && !replies.some(r => r.to === move.slice(2, 4)), 'coupure de Lucena');
  }
  if (has('guard-pawn')) ok(B.isAttacked(P.sq, them) && !B.isAttacked(P.sq, us) && A.isAttacked(P.sq, us), 'pion protégé');
  if (has('rook-supports')) { const r = move.slice(2, 4); ok(fileOf(r) === fileOf(P.sq) && rel(r, P.color) < rel(P.sq, P.color) && A.isAttacked(P.sq, us), 'tour derrière son pion'); }
  if (has('king-shelter')) ok(!replies.some(r => { if (r.captured) return true; A.move(r); const k = A.isCheck(); A.undo(); return k; }), 'abri');

  // ---- Philidor ----
  if (has('philidor-third')) {
    const r = move.slice(2, 4);
    ok(rel(r, P.color) === 5 && rel(P.sq, P.color) <= 4 && !replies.some(x => x.piece === 'k' && rel(x.to, P.color) === 5) && txt.includes(`la ${rankOf(r) + 1}e rangée`), '3e rangée');
  }
  if (has('philidor-behind')) ok(rel(P.sq, P.color) === 5 && rel(move.slice(2, 4), P.color) <= 1, 'échecs par derrière');
  if (has('far-check')) {
    const r = move.slice(2, 4);
    ok(A.isCheck() && cheb(r, Kt) >= 3 && !replies.some(x => x.to === r || (x.piece === 'k' && cheb(x.to, r) <= 1)), 'échec de loin');
  }
  if (has('guarded-check')) ok(A.isCheck() && cheb(move.slice(2, 4), Kt) === 1 && cheb(move.slice(2, 4), Ku) === 1 && replies.every(x => x.piece === 'k'), 'échec protégé');
  if (has('promo-guard')) ok(cheb(Ku, promoOf(P)) <= 1 && txt.includes(promoOf(P)), 'case de promotion');
  if (has('king-attacks-pawn')) ok(cheb(Ku, P.sq) === 1 && (/n’est pas protégé/.test(txt) ? !A.isAttacked(P.sq, them) : A.isAttacked(P.sq, them)), 'attaque du pion');
  if (has('rook-far')) {
    const r = move.slice(2, 4), nl = new Chess(nullMoveFen(fenA));
    ok(rel(r, P.color) <= rel(Kt, P.color) - 3 && nl.moves({ square: r, verbose: true }).some(m => { nl.move(m); const k = nl.isCheck(); nl.undo(); return k; }), 'tour loin');
  }

  // ---- Visuels ----
  const v = e.viz || {};
  for (const s of [...(v.zone || []), ...Object.keys(v.marks || {}), ...(v.arrows || []).flatMap(a => [a.from, a.to])]) ok(SQS.includes(s), `case ${s}`);
  ok((v.arrows || []).length <= 2 && Object.keys(v.marks || {}).length <= 6, 'trop de visuels');
}

// Invariance : les étiquettes ne changent pas par miroir gauche-droite ni par échange des couleurs.
function invariance(args, e, where) {
  for (const [fx, f, s] of [['miroir', mirrorFiles, mirrorSq], ['couleurs', swapColors, flipSq]]) {
    const e2 = explainMove({ ...args, fen: f(args.fen), move: mapUci(args.move, s), lastMove: args.lastMove && mapUci(args.lastMove, s), pv: (args.pv || []).map(u => mapUci(u, s)) });
    assert.deepEqual(e2.tags, e.tags, `${where} ${fx} : ${e2.text} | ${e.text}`);
  }
}

// =====================================================================================================
// 1. Fixtures (une par fait principal)
// =====================================================================================================
const FIX = [
  // KPK attaque
  { name: 'case clé', fen: '8/8/8/5k2/8/4K3/4P3/8 w - - 0 1', move: 'e3d4', family: 'kpk', id: 'key-square', re: /case clé d4 : la promotion est assurée, quoi que joue le roi noir/ },
  { name: 'prendre l’opposition', fen: '8/4k3/8/5K2/8/3P4/8/8 w - - 0 1', move: 'f5e5', family: 'kpk', ideas: ['opposition', 'outflank', 'waiting'], id: 'opposition', re: /Tu prends l’opposition : rois face à face, une case entre eux, et c’est au roi noir de jouer/ },
  { name: 'opposition à distance', fen: '6k1/2p5/8/8/8/8/8/5K2 b - - 0 1', move: 'g8f7', family: 'kpk', id: 'opposition', re: /opposition à distance : 5 cases entre les rois/ },
  { name: 'coup d’attente du pion', fen: '8/2k1K3/8/8/3P4/8/8/8 w - - 0 1', move: 'd4d5', family: 'kpk', id: 'pawn-tempo', re: /Coup d’attente du pion : les rois restent face à face/ },
  // KPK défense
  { name: 'recul tout droit', fen: '8/8/8/4k3/4P3/4K3/8/8 b - - 0 1', move: 'e5e6', family: 'kpk-def', id: 'def-straight', re: /recule tout droit.*Tu pourras reprendre l’opposition quand le roi blanc avancera/ },
  { name: 'défense : opposition', fen: '8/8/6k1/8/8/5PK1/8/8 b - - 0 1', move: 'g6g5', family: 'kpk-def', id: 'opposition', re: /Tu prends l’opposition.*Le roi blanc ne peut pas avancer/ },
  { name: 'pion de la tour : le coin', fen: '8/2k5/P7/8/8/8/2K5/8 b - - 0 1', move: 'c7b8', family: 'kpk-def', id: 'rook-pawn-corner', re: /Pion de la tour : ton roi atteint le coin, c’est nulle/ },
  { name: 'pion de la tour : vers le coin', fen: '3k4/8/8/P7/8/8/2K5/8 b - - 0 1', move: 'd8c7', family: 'kpk-def', id: 'rook-pawn-corner', re: /file vers le coin/ },
  { name: 'règle du carré', fen: '8/8/8/8/8/P2k4/8/4K3 b - - 0 1', move: 'd3c3', family: 'kpk-def', ideas: ['enter-square', 'diagonal-walk'], id: 'enter-square', re: /carré du pion : il arrivera à temps/ },
  // Dame contre pion
  { name: 'échec qui force le roi devant son pion', fen: '4K3/8/8/8/4Q3/8/1p6/k7 w - - 0 1', move: 'e4a4', family: 'kqkp', id: 'in-front', re: /Après Da4\+, le roi noir n’a qu’un coup, Rb1, devant son pion/ },
  { name: 'clouage du pion', fen: '8/8/K7/8/8/5Q2/3kp3/8 w - - 0 1', move: 'f3f2', family: 'kqkp', id: 'pawn-pin', re: /Ta dame cloue le pion contre son roi : il ne peut pas avancer/ },
  { name: 'défense par le pat (pion fou)', fen: '1K6/2P5/1q6/8/8/8/1k6/8 w - - 0 1', move: 'b8a8', family: 'kqkp-def', id: 'stalemate-defence', re: /Ton roi abandonne son pion : si la dame le prend, c’est pat/ },
  { name: 'pion de la tour : le coin (dame)', fen: '8/8/8/7K/8/8/pk4Q1/8 b - - 0 1', move: 'b2a1', family: 'kqkp-def', id: 'corner-hide', re: /ton roi se cache dans le coin, devant son pion\. 2 coups adverses feraient déjà pat/ },
  // Tour contre pion
  { name: 'coupure', fen: '8/8/8/7R/4p3/6k1/8/3K4 w - - 0 1', move: 'h5f5', family: 'krkp', id: 'pawn-cut', re: /Ta tour coupe le roi noir de son pion : tant qu’elle tient la colonne f, il ne peut pas la franchir/ },
  { name: 'coupure sur une rangée', fen: '8/6k1/8/4p3/1R6/8/8/3K4 w - - 0 1', move: 'b4b6', family: 'krkp', id: 'pawn-cut', re: /de son pion : tant qu’elle tient la 6e rangée/ },
  { name: 'roi devant le pion', fen: '8/6k1/8/4p3/1R6/8/8/3K4 w - - 0 1', move: 'd1e2', family: 'krkp', id: 'king-blocks', re: /Ton roi se place devant le pion/ },
  { name: 'tour derrière le pion', fen: '8/8/2R5/6p1/3K4/6k1/8/8 w - - 0 1', move: 'c6g6', family: 'krkp', id: 'rook-behind', re: /Ta tour se place derrière le pion et l’attaque/ },
  // Lucena
  { name: 'Lucena : le pont', fen: '3K4/3P4/6k1/8/8/8/2r5/4R3 w - - 0 1', move: 'e1e4', family: 'lucena', id: 'lucena-bridge', re: /Tu construis le pont : ta tour se place sur la 4e rangée/ },
  { name: 'Lucena : le roi sort', fen: '3K4/3P4/6k1/8/8/8/2r5/4R3 w - - 0 1', move: 'd8e7', family: 'lucena', id: 'lucena-out', re: /Ton roi sort de devant son pion : la case de promotion est libre\. Le pion menace d’aller à dame/ },
  { name: 'Lucena : interposition', fen: '8/8/8/4R3/6r1/4k3/4p2K/8 b - - 0 1', move: 'g4e4', family: 'lucena', id: 'lucena-block', re: /Ta tour s’interpose.*protégée par ton roi/ },
  // Philidor
  { name: 'Philidor : la 3e rangée', fen: '3k4/R7/8/1KP2r2/8/8/8/8 b - - 0 1', move: 'f5f6', family: 'philidor', id: 'philidor-third', re: /Défense Philidor : ta tour garde la 6e rangée \(ta 3e\), le roi blanc ne peut pas y avancer/ },
  { name: 'Philidor : échecs par derrière', fen: '4k3/8/r3P3/4K3/8/8/8/7R b - - 0 1', move: 'a6a2', family: 'philidor', id: 'philidor-behind', re: /Le pion est arrivé sur la 6e rangée : ta tour file tout en bas/ },
  { name: 'Philidor : échec de loin', fen: '4k3/R7/4P3/3K4/8/8/8/r7 b - - 0 1', move: 'a1d1', family: 'philidor', id: 'far-check', re: /Échec par derrière, de loin : le roi blanc ne peut pas s’approcher de ta tour/ },
];
test(`fixtures : ${FIX.length} faits des finales avec pion`, () => {
  for (const F of FIX) {
    const args = { fen: F.fen, move: F.move, family: F.family, ideas: F.ideas || DRILL_IDEAS[F.family] || [], tb };
    const e = explainMove(args);
    assert.equal(e.debug.primary, F.id, `${F.name} : ${e.text.join(' ')} [${e.tags}]`);
    assert.match(plain(e.text.join(' ')), F.re, F.name);
    verify(F.fen, F.move, e, F.name);
    const e1 = explainMove({ ...args, level: 1 });
    verifyLevel1(F.fen, F.move, e1, F.name);
    invariance(args, e, F.name);
  }
  assert.equal(stats.errors, 0, String(stats.last && stats.last.stack));
});
// Idées des exercices de chaque famille (pour les fixtures)
const DRILL_IDEAS = {
  kpk: ['key-square', 'opposition', 'king-in-front', 'waiting'], 'kpk-def': ['def-front', 'def-straight', 'opposition'],
  kqkp: ['in-front', 'approach'], 'kqkp-def': ['stalemate-defence', 'rook-pawn-corner'], krkp: ['cut', 'king-in-front', 'rook-behind'],
  lucena: ['lucena-cut', 'lucena-bridge', 'lucena-out', 'lucena-block'], philidor: ['philidor-third', 'philidor-behind', 'def-front'],
};

test('greffons : les sept familles sont enregistrées, avec repli et raisons d’erreur', () => {
  for (const id of ['kpk', 'kpk-def', 'kqkp', 'kqkp-def', 'krkp', 'lucena', 'philidor']) {
    const f = FAMILIES[id];
    assert.ok(f && f.id === id, id);
    assert.ok(f.fallback && f.fallback.idea && f.fallback.say, id);
    checkText([fr(f.fallback.say)], `${id} repli`);
    checkText([fr(f.fallback.idea)], `${id} idée`, { level: 1 });
  }
  for (const id of ['opposition-given', 'push-too-early', 'entered-square']) assert.ok(FAMILIES.kpk.mistakes.includes(id) || FAMILIES['kpk-def'].mistakes.includes(id), id);
});

// =====================================================================================================
// 2. Propriétés : tables exactes (kpk, kpk-def) sur des positions produites par les exercices
// =====================================================================================================
const report = {};
const FAMILY_DRILLS = {
  kpk: ['pion-roi-devant', 'pion-opposition', 'pion-cases-cles'], 'kpk-def': ['pion-carre', 'pion-defense', 'pion-tour'],
  kqkp: ['dame-contre-pion'], 'kqkp-def': ['dame-contre-pion-nulle'], krkp: ['tour-contre-pion'], lucena: ['lucena'], philidor: ['philidor'],
};
const LOOKAHEAD = ['lookahead', 'tb-count'];
const STARTS = new Map();   // positions de départ produites (réutilisées par l'intégration)

// Coups également bons (comme Attempt.candidates) : tables.
function tbCandidates(fen) {
  const p = probe(fen);
  if (!p) return [];
  const turn = fen.split(' ')[1], strong = p.strong === turn, r = tb.rankMoves(fen);
  let good = r.filter(m => (strong ? m.win : !m.win));
  if (strong && good.length) { const d = Math.min(...good.map(m => m.dist)); good = good.filter(m => m.dist === d); }
  return good.map(m => m.uci);
}
// Une position explique : pick + niveau 1 + niveau 3, vérifie, mesure.
function examine({ fen, cands, spec, lastMove, pv, lines }, acc) {
  const t0 = performance.now();
  const move = pickTeachingMove({ fen, family: spec.family, ideas: spec.ideas, candidates: cands, tb, lastMove });
  const linePv = lines ? (lines.find(l => l.move === move)?.pv || [move]) : (pv || [move]);
  const args = { fen, move, family: spec.family, ideas: spec.ideas, pv: linePv, lastMove, tb, tip: spec.tip };
  const e1 = explainMove({ ...args, level: 1 });
  const e = explainMove({ ...args, level: 3 });
  acc.times.push(performance.now() - t0);
  assert.ok(cands.includes(move), `${fen} : ${move} hors des candidats`);
  const where = `${spec.id} ${fen} ${move}`;
  verify(fen, move, e, where, { lastMove });
  verifyLevel1(fen, move, e1, where);
  invariance(args, e, where);
  const id = e.debug.primary || 'fallback';
  acc.ids[id] = (acc.ids[id] || 0) + 1;
  acc.n++;
  return move;
}
const fresh = () => ({ n: 0, ids: {}, times: [] });
function summarize(family, acc) {
  const fb = (acc.ids.fallback || 0) / acc.n, la = LOOKAHEAD.reduce((s, k) => s + (acc.ids[k] || 0), 0) / acc.n;
  report[family] = { n: acc.n, fallback: +(fb * 100).toFixed(1), lookahead: +(la * 100).toFixed(1), medianMs: +median(acc.times).toFixed(2), maxMs: +Math.max(...acc.times).toFixed(1), ids: acc.ids };
  return { fb, med: median(acc.times) };
}

for (const family of ['kpk', 'kpk-def']) {
  const n = N(60, 240, 1000);
  test(`propriétés ${family} : ${n} positions produites × coup pédagogique (tables exactes)`, { timeout: 10 * 60e3 }, async () => {
    const acc = fresh(), rng = mulberry32(family.length * 977);
    const drills = FAMILY_DRILLS[family];
    for (let k = 0; acc.n < n && k < n * 4; k++) {
      const spec = DRILLS[drills[k % drills.length]];
      const ctx = { engine: null, tb, rng };
      const colour = rng() < 0.35 ? other(spec.userSide) : spec.userSide;
      const s = await produce(spec, k % spec.levels.length, ctx, { colour });
      if (!s) continue;
      if (!STARTS.has(spec.id)) STARTS.set(spec.id, s);
      let fen = s.fen, lastMove = null;
      for (let ply = 0; ply < 10 && acc.n < n; ply++) {
        const cands = tbCandidates(fen);
        if (!cands.length) break;
        const move = examine({ fen, cands, spec, lastMove }, acc);
        // on joue le coup pédagogique (ou parfois un autre bon coup), puis la réponse de l'oracle adverse
        const c = new Chess(fen), m = c.move(toMove(rng() < 0.7 ? move : cands[Math.floor(rng() * cands.length)]));
        if (c.isGameOver() || m.captured || m.promotion) break;
        const rep = tb.stubborn(c.fen(), rng);
        if (!rep) break;
        const r = c.move(toMove(rep));
        if (c.isGameOver() || r.captured || r.promotion) break;
        fen = c.fen(); lastMove = rep;
      }
    }
    const { fb, med } = summarize(family, acc);
    assert.ok(acc.n >= n * 0.9, `${family} : ${acc.n} positions`);
    if (acc.n >= 30) assert.ok(fb < 0.15, `${family} : taux de repli ${(fb * 100).toFixed(1)} % ${JSON.stringify(acc.ids)}`);
    assert.ok(med < 20, `${family} : médiane ${med.toFixed(2)} ms`);
    assert.equal(stats.errors, 0, String(stats.last && stats.last.stack));
  });
}

// La règle du coin (pion de la tour) est vraie sur toute la table : roi du défenseur dans la zone du coin ⇒ nulle.
test('pion de la tour : roi défenseur dans le coin ⇒ nulle, quel que soit le trait (table KPK entière)', () => {
  let n = 0;
  for (const p of ['a2', 'a3', 'a4', 'a5', 'a6', 'a7']) for (const bk of ['a8', 'b8', 'a7', 'b7']) for (const wk of SQS) for (const t of ['w', 'b']) {
    if (new Set([p, bk, wk]).size < 3 || cheb(wk, bk) <= 1) continue;
    const c = new Chess('8/8/8/8/8/8/8/8 w - - 0 1', { skipValidation: true });
    c.put({ type: 'p', color: 'w' }, p); c.put({ type: 'k', color: 'b' }, bk); c.put({ type: 'k', color: 'w' }, wk);
    const fen = c.fen().replace(/ [wb] /, ` ${t} `), pr = probe(fen);
    if (!pr) continue;
    n++;
    assert.ok(!pr.win, fen);
  }
  assert.ok(n > 2000, String(n));
});

// =====================================================================================================
// 3. Propriétés : familles moteur (Stockfish ~300 ms, MultiPV 3) sur des positions produites
// =====================================================================================================
async function engineCandidates(eng, fen) {
  const lines = await eng.analyse(fen, { movetime: 300, multipv: 3 });
  if (!lines.length) return { cands: [], lines };
  const b = lines[0];
  const good = lines.filter(l => (b.mate != null ? l.mate === b.mate : l.mate == null && b.cp - l.cp <= 15));
  return { cands: good.map(l => l.move), lines: good };
}
for (const family of ['kqkp', 'kqkp-def', 'krkp', 'lucena', 'philidor']) {
  const starts = N(2, 8, 20), plies = N(4, 10, 12);
  test(`propriétés ${family} : ${starts} départs produits × ${plies} coups (Stockfish)`, { timeout: 30 * 60e3 }, async () => {
    const eng = await getEngine(), spec = DRILLS[FAMILY_DRILLS[family][0]], acc = fresh();
    const rng = mulberry32(family.length * 131), ctx = { engine: eng, tb, rng };
    let produced = 0;
    for (let k = 0; produced < starts && k < starts * 3; k++) {
      const colour = k % 2 ? other(spec.userSide) : spec.userSide;
      const s = await produce(spec, k % spec.levels.length, ctx, { colour });
      if (!s) continue;
      produced++;
      if (!STARTS.has(spec.id)) STARTS.set(spec.id, s);
      let fen = s.fen, lastMove = null;
      for (let ply = 0; ply < plies; ply++) {
        const { cands, lines } = await engineCandidates(eng, fen);
        if (!cands.length) break;
        const move = examine({ fen, cands, spec, lastMove, lines }, acc);
        const c = new Chess(fen), m = c.move(toMove(move));
        if (c.isGameOver() || m.captured || m.promotion) break;
        const [r] = await eng.analyse(c.fen(), { movetime: 100 });
        if (!r || !r.move) break;
        const rm = c.move(toMove(r.move));
        if (c.isGameOver() || rm.captured || rm.promotion) break;
        fen = c.fen(); lastMove = r.move;
      }
    }
    const { fb, med } = summarize(family, acc);
    assert.ok(produced >= Math.ceil(starts / 2), `${family} : ${produced} départs`);
    // Sur un petit échantillon (QUICK : une dizaine de coups) le taux de repli n'a pas de sens statistique.
    if (acc.n >= 30) assert.ok(fb < 0.2, `${family} : taux de repli ${(fb * 100).toFixed(1)} % ${JSON.stringify(acc.ids)}`);
    assert.ok(med < 20, `${family} : médiane ${med.toFixed(2)} ms`);
    assert.equal(stats.errors, 0, String(stats.last && stats.last.stack));
  });
}

// =====================================================================================================
// 4. Erreurs (tables) : raisons vérifiées — opposition laissée, pion poussé trop tôt, carré
// =====================================================================================================
function verifyReason(fen, u, m, where) {
  const B = new Chess(fen), us = B.turn(), them = other(us), P = pawnOf(B), A = after1(fen, u), t = plain(m.text[0]);
  const reply = t.match(/\((\S+)\)|après (\S+?),/);
  const playReply = () => { const san = enSan((reply[1] || reply[2]).replace(/[()]/g, '')); const c = new Chess(A.fen()); c.move(san); return c; };
  if (m.tags.includes('opposition-given')) {
    const c = playReply(), Ku = kingSq(c, us), Kt = kingSq(c, them);
    assert.ok(opp(Ku, Kt) && c.turn() === us, `${where} : opposition ${t}`);
    assert.ok(P.color === us ? drawn(c.fen()) : winFor(c.fen(), them), `${where} : tables ${t}`);
  }
  if (m.tags.includes('push-too-early')) {
    assert.equal(new Chess(fen).get(u.slice(0, 2)).type, 'p', where);
    assert.ok(drawn(A.fen()), where);
    if (/se place devant lui/.test(t)) { const c = playReply(), K = kingSq(c, them), PA = pawnOf(A); assert.ok(fileOf(K) === fileOf(PA.sq) && rel(K, P.color) > rel(PA.sq, P.color) && drawn(c.fen()), `${where} : ${t}`); }
    else assert.ok(!keys(P).includes(kingSq(B, us)), `${where} : case clé ${t}`);
  }
  if (m.tags.includes('entered-square')) {
    if (/sort du carré/.test(t)) {
      assert.ok(cheb(u.slice(0, 2), promoOf(P)) <= toPromote(P) + 1 && cheb(u.slice(2, 4), promoOf(P)) > toPromote(P) && winFor(A.fen(), them), `${where} : ${t}`);
    } else if (/Tu laisses passer/.test(t)) {
      const c = playReply(), K = kingSq(c, them);
      assert.ok(keys(P).includes(K) && winFor(c.fen(), them), `${where} : ${t}`);
    } else {
      const c = playReply(), K = kingSq(c, them);
      assert.ok(cheb(K, promoOf(P)) <= toPromote(P) && drawn(c.fen()), `${where} : ${t}`);
    }
  }
}
test(`erreurs kpk / kpk-def : ${N(60, 200, 600)} coups perdants (tables), raisons revérifiées`, async () => {
  const rng = mulberry32(4242), need = N(60, 200, 600), tally = { kpk: [0, 0], 'kpk-def': [0, 0] }, ids = {};
  let done = 0;
  for (let k = 0; done < need && k < need * 10; k++) {
    const family = k % 2 ? 'kpk-def' : 'kpk', drills = FAMILY_DRILLS[family], spec = DRILLS[drills[k % 3]];
    const s = await produce(spec, k % spec.levels.length, { engine: null, tb, rng }, { colour: rng() < 0.35 ? other(spec.userSide) : spec.userSide });
    if (!s) continue;
    const r = tb.rankMoves(s.fen), p = probe(s.fen), strong = p.strong === s.fen.split(' ')[1];
    const bad = r.filter(x => (strong ? !x.win : x.win));
    if (!bad.length) continue;
    const u = bad[Math.floor(rng() * bad.length)].uci, cands = tbCandidates(s.fen);
    const best = pickTeachingMove({ fen: s.fen, family, ideas: spec.ideas, candidates: cands, tb });
    const m = explainMistake({ fen: s.fen, userMove: u, bestMove: best, family, tb });
    const where = `${family} ${s.fen} U=${u}`;
    checkText(m.text, where, { max: 4, perLine: true });
    assert.equal(m.severity, strong ? 'win-draw' : 'draw-loss', where);
    verifyReason(s.fen, u, m, where);
    assert.match(plain(m.text.at(-1)), /^Mieux : /, where);
    const why = m.tags.find(x => x !== m.severity) || 'generic';
    ids[why] = (ids[why] || 0) + 1;
    tally[family][0]++; if (why !== 'generic') tally[family][1]++;
    done++;
  }
  report['erreurs'] = { n: done, specific: Object.fromEntries(Object.entries(tally).map(([f, [a, b]]) => [f, a ? +(100 * b / a).toFixed(1) : null])), ids };
  assert.ok(done >= need * 0.8, `${done} erreurs`);
  assert.ok(['opposition-given', 'push-too-early', 'entered-square'].every(x => ids[x] > 0), JSON.stringify(ids));
});

test('erreurs dame / tour contre pion : pion laissé à dame, coupure perdue (revérifiées)', () => {
  const cases = [
    { fen: '8/8/K7/8/8/5Q2/3kp3/8 w - - 0 1', u: 'f3a8', b: 'f3f2', family: 'kqkp', tag: 'allows-promotion' },
    { fen: '4K3/8/8/8/4Q3/8/1p6/k7 w - - 0 1', u: 'e4h4', b: 'e4a4', family: 'kqkp', tag: 'allows-promotion' },
    { fen: '8/8/8/7R/4p3/6k1/8/3K4 w - - 0 1', u: 'h5h8', b: 'h5f5', family: 'krkp', tag: 'cut-lost' },
  ];
  for (const C of cases) {
    const m = explainMistake({ fen: C.fen, userMove: C.u, bestMove: C.b, family: C.family, evalBest: 1200, evalUser: 0 });
    const where = `${C.family} ${C.fen} U=${C.u}`, t = plain(m.text[0]);
    assert.equal(m.severity, 'win-draw', where);
    assert.ok(m.tags.includes(C.tag), `${where} : ${m.tags} ${m.text}`);
    checkText(m.text, where, { max: 4, perLine: true });
    if (C.tag === 'allows-promotion') {
      const san = enSan(t.match(/après (\S+?),/)[1]), c = after1(C.fen, C.u);
      const r = c.move(san);
      assert.ok(r.promotion === 'q' && !c.moves({ verbose: true }).some(y => y.to === r.to && y.captured), where);
    }
    assert.match(plain(m.text[1]), /^Mieux : /, where);
  }
});

// =====================================================================================================
// 5. Intégration : Attempt (indices 1→3, coup perdant, « Pourquoi ? ») — un exercice par famille
// =====================================================================================================
async function losingMove(a, eng) {
  const fen = a.fen;
  if (a.spec.oracle === 'tb') {
    const p = probe(fen), strong = p.strong === a.userColor;
    const bad = tb.rankMoves(fen).filter(x => (strong ? !x.win : x.win));
    return bad.length ? bad[0].uci : null;
  }
  // moteur : un coup qui perd la tour ou la dame (prise sans reprise), sinon le pire coup selon une recherche courte
  const c = new Chess(fen), ms = c.moves({ verbose: true });
  for (const m of ms) {
    c.move(m);
    let hang = false;
    for (const y of c.moves({ verbose: true })) {
      if (y.captured !== 'q' && y.captured !== 'r') continue;
      c.move(y);
      const back = c.moves({ verbose: true }).some(z => z.to === y.to && z.captured);
      c.undo();
      if (!back) { hang = true; break; }
    }
    c.undo();
    if (hang) return m.from + m.to + (m.promotion || '');
  }
  let worst = null;
  for (const m of ms.slice(0, 16)) {
    const [l] = await eng.analyse(after1(fen, m.from + m.to + (m.promotion || '')).fen(), { movetime: 60 });
    if (l && (!worst || l.cp > worst.cp)) worst = { cp: l.cp, uci: m.from + m.to + (m.promotion || '') };
  }
  return worst && worst.cp >= 300 ? worst.uci : null;
}
const INTEGRATION = ['pion-cases-cles', 'pion-defense', 'dame-contre-pion', 'dame-contre-pion-nulle', 'tour-contre-pion', 'lucena', 'philidor'];
test(`intégration Attempt : ${INTEGRATION.length} exercices (indices 1 à 3, puis « Pourquoi ? » après un coup perdant)`, { timeout: 20 * 60e3 }, async () => {
  const eng = await getEngine();
  const out = {};
  for (const id of INTEGRATION) {
    const spec = DRILLS[id], ctx = { engine: spec.oracle === 'engine' ? eng : null, tb, rng: mulberry32(id.length) };
    // départ produit dont au moins un coup perd (sinon on en produit un autre)
    let start = STARTS.get(id) || await produce(spec, 0, ctx), a = null, bad = null;
    for (let k = 0; k < 6 && start; k++) {
      a = new Attempt(spec, start, ctx);
      bad = await losingMove(a, eng);
      if (bad) break;
      start = await produce(spec, k % spec.levels.length, ctx);
    }
    assert.ok(start && start.fen && bad, `${id} : aucun départ avec un coup perdant`);
    const fen = a.fen;
    const r1 = await a.hint(), r2 = await a.hint(), r3 = await a.hint();
    assert.deepEqual([r1.step, r2.step, r3.step], [1, 2, 3], id);
    assert.equal(r1.move, r3.move, id);
    if (spec.oracle === 'tb') assert.ok(tbCandidates(fen).includes(r1.move), `${id} : indice hors des meilleurs coups`);
    verifyLevel1(fen, r1.move, r1, `${id} indice 1`);
    verifyLevel1(fen, r2.move, r2, `${id} indice 2`);
    verify(fen, r3.move, r3, `${id} indice 3`);
    const res = await a.userMove(bad);
    assert.equal(res.status, 'end', `${id} : ${bad} n’a pas fini la tentative (${fen})`);
    assert.equal(a.outcome.status, 'fail', id);
    const w = await a.why();
    assert.ok(w && w.fen === fen && w.userMove === bad, id);
    checkText(w.text, `${id} pourquoi`, { max: 4, perLine: true });
    assert.match(plain(w.text.at(-1)), /^Mieux : /, id);
    if (spec.oracle === 'tb') assert.ok(['win-draw', 'draw-loss'].includes(w.severity), `${id} : ${w.severity}`);
    out[id] = { hint: r3.debug?.primary ?? r3.tags[0], why: w.tags.join(',') };
  }
  report.integration = out;
});

after(() => {
  if (process.env.EXPLAIN_REPORT || !QUICK) for (const [k, v] of Object.entries(report)) console.log(`# ${k} : ${JSON.stringify(v)}`);
});
