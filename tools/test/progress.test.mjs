// Progression v2 (spec §1.8 et §4) : codes, escalier, états, contrôles, révisions implicites, migration v1,
// import d'une sauvegarde, séance du jour, mélange et textes. Fonctions pures, horloge simulée, aucun moteur.
// node --test tools/test/progress.test.mjs   (QUICK=1 n'a rien à raccourcir : tout tourne en moins d'une seconde)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../../js/progress.js';

const { DAY } = P;

// ---------- Registre factice (11 exercices, dont un de phase B) ----------
const mk = (id, track, nLevels, extra = {}) => ({
  id, track, title: extra.title || id, short: id, phase: 'A', oracle: 'tb', family: 'kqk', userSide: 'w',
  goal: { kind: 'mate' }, flip: true, need: 3, prereq: [], tip: '', ideas: [],
  levels: [...Array(nLevels)].map((_, i) => ({ label: `Palier ${i + 1}` })), ...extra,
});
const SPECS = [
  mk('rr', 'mats', 1, { title: 'Deux tours', oracle: 'engine' }),
  mk('dame', 'mats', 3, { title: 'Mat avec la dame' }),
  mk('tour', 'mats', 4, { title: 'Mat avec la tour' }),
  mk('dame-pions', 'mats', 3, { title: 'Dame et pions', prereq: ['dame'], covers: ['dame'] }),
  mk('carre', 'pions', 2, { title: 'La règle du carré', userSide: 'b', goal: { kind: 'hold', n: 8, band: 'draw' } }),
  mk('oppo', 'pions', 2, { title: 'Prendre l’opposition', flip: false, prereq: ['carre'], goal: { kind: 'promote' } }),
  mk('prise', 'tactique', 3, { title: 'Pièce en prise', need: 5, goal: { kind: 'material', gain: 3, within: 2 } }),
  mk('fourche', 'tactique', 3, { title: 'Fourchette', need: 5, prereq: ['prise'], goal: { kind: 'material', gain: 6, within: 3 } }),
  mk('couloir', 'images', 3, { title: 'Mat du couloir', goal: { kind: 'mate', n: 1 }, contrast: ['parer'] }),
  mk('parer', 'vigilance', 3, { title: 'Pare le mat du couloir', prereq: ['couloir'], contrast: ['couloir'], goal: { kind: 'hold', n: 3, band: 'keep' } }),
  mk('futur', 'tours', 1, { title: 'Phase B', phase: 'B' }),
];
const byId = Object.fromEntries(SPECS.map(d => [d.id, d]));
const coveredBy = {};
for (const d of SPECS) for (const x of d.covers || []) (coveredBy[x] ||= []).push(d.id);
const REG = { byId, list: SPECS, parcours: ['rr', 'dame', 'prise', 'tour', 'couloir', 'carre', 'oppo', 'fourche', 'parer', 'dame-pions'], coveredBy };

// ---------- Horloge et tentatives simulées ----------
// Mardi 6 octobre 2026, heure locale : at(j, h) = j jours plus tard à h heures.
const at = (d, h = 9, m = 0) => new Date(2026, 9, 6 + d, h, m).getTime();
const T0 = at(0);
const rng = () => 0.5;                         // facteur d'intervalle 0,9 + 0,5·0,2 = 1 exactement
const OPT = { rng };
const top = id => byId[id].levels.length - 1;
function attempt(code, o = {}) {
  const base = { level: 0, color: 'w', reached: true, clean: true, moves: 10, ref: 8, hints: 0, hintMax: 0, secs: 60, retry: false, abandoned: false, keyFen: null, fromErr: null };
  const by = { C: {}, S: { clean: false }, H: { hints: 1, hintMax: 1, clean: false }, F: { reached: false, clean: false }, A: { abandoned: true, reached: false, clean: false, moves: 3 }, R: { retry: true } };
  return { ...base, ...by[code], ...o };
}
const store = () => P.migrate({ finales: {}, menace: {}, puzzles: {}, days: {}, stats: {} }, T0);
// Joue une suite de codes : 'C' Blancs, 'Cb' Noirs ; palier = palier courant (dernier palier si acquis).
function play(s, id, seq, now = T0, o = {}) {
  const out = [];
  for (const tok of seq.split(' ').filter(Boolean)) {
    const r = s.drills[id], spec = byId[id];
    const level = o.level ?? (r && ['acq', 'mast', 'rusty'].includes(r.st) ? top(id) : (r?.level ?? 0));
    out.push(P.record(s, spec, attempt(tok[0], { level, color: tok[1] === 'b' ? 'b' : 'w', ...o }), now, REG, OPT));
    now += 60e3;
  }
  return out.join('');
}
// Fiche réglée à la main.
function put(s, id, fields) { s.drills[id] = { ...P.fresh(), ...fields }; return s.drills[id]; }
const mastAt = (s, id, box, lastChk, extra = {}) => put(s, id, { st: 'mast', level: top(id), fast: false, box, lastChk, acqAt: lastChk - 5 * DAY, chk: P.dayStr(lastChk), due: lastChk + P.DRILL_INTERVALS[box] * DAY, ...extra });

// ---------- §4.1 ----------
test('codes de résultat', () => {
  const sp = byId.dame;
  assert.equal(P.outcome(sp, attempt('R')), 'R');
  assert.equal(P.outcome(sp, attempt('A')), 'A');
  assert.equal(P.outcome(sp, attempt('A', { moves: 0 })), null, 'abandon avant le premier coup : rien');
  assert.equal(P.outcome(sp, attempt('F')), 'F');
  assert.equal(P.outcome(sp, attempt('H')), 'H');
  assert.equal(P.outcome(sp, attempt('C')), 'C');
  assert.equal(P.outcome(sp, attempt('S')), 'S');
  assert.equal(P.outcome(sp, attempt('R', { reached: false })), 'R', 'hors série prime sur tout');
  // Sans `clean` fourni : règles du tableau §2.4.
  const c = (goal, moves, ref, k) => P.outcome({ goal }, { reached: true, hints: 0, moves, ref, k });
  assert.equal(c({ kind: 'mate' }, 15, 12), 'C'); assert.equal(c({ kind: 'mate' }, 16, 12), 'S');
  assert.equal(c({ kind: 'mate' }, 4, 2), 'C'); assert.equal(c({ kind: 'mate' }, 5, 2), 'S');
  assert.equal(c({ kind: 'mate' }, 30, null), 'C', 'sans référence : propre');
  assert.equal(c({ kind: 'mate', n: 2 }, 2, null), 'C'); assert.equal(c({ kind: 'mate', n: 2 }, 3, null), 'S');
  assert.equal(c({ kind: 'promote' }, 12, 9), 'C'); assert.equal(c({ kind: 'promote' }, 13, 9), 'S');
  assert.equal(c({ kind: 'promote' }, 7, 4), 'C'); assert.equal(c({ kind: 'promote' }, 8, 4), 'S');
  assert.equal(c({ kind: 'material' }, 2, null, 1), 'C'); assert.equal(c({ kind: 'material' }, 3, null, 1), 'S');
  assert.equal(c({ kind: 'hold', n: 8 }, 8, null), 'C');
  assert.equal(P.slackMate(12), 3); assert.equal(P.slackMate(8), 2); assert.equal(P.slackPromo(19), 7);
});

// ---------- §4.2 ----------
test('voie rapide, puis trois pour monter et un pour descendre', () => {
  const s = store(), r = () => s.drills.tour;
  play(s, 'tour', 'C');
  assert.equal(r().st, 'learn'); assert.equal(r().level, 1, 'voie rapide : une partie propre suffit');
  play(s, 'tour', 'C C');
  assert.equal(r().level, 3); assert.equal(r().fast, true);
  assert.equal(r().streak, 0, 'la série repart à zéro en changeant de palier');
  play(s, 'tour', 'F');
  assert.equal(r().level, 2); assert.equal(r().fast, false, 'premier échec : fin de la voie rapide');
  play(s, 'tour', 'C C');
  assert.equal(r().level, 2); assert.equal(r().up, 2);
  play(s, 'tour', 'S');
  assert.equal(r().up, 0, 'S remet le compteur à zéro'); assert.equal(r().level, 2, 'sans faire descendre');
  play(s, 'tour', 'C C H');
  assert.equal(r().up, 0); assert.equal(r().level, 2, 'H est neutre pour le palier');
  play(s, 'tour', 'C C C');
  assert.equal(r().level, 3);
  play(s, 'tour', 'A');
  assert.equal(r().level, 2, 'un abandon fait descendre aussi');
  play(s, 'tour', 'F F F');
  assert.equal(r().level, 0); play(s, 'tour', 'F'); assert.equal(r().level, 0, 'pas sous le premier palier');
  // Une position d'un autre palier (erreur rejouée) ne bouge pas l'escalier.
  const s2 = store();
  put(s2, 'tour', { st: 'learn', level: 2, fast: true });
  play(s2, 'tour', 'F', T0, { level: 0 });
  assert.equal(s2.drills.tour.level, 2); assert.equal(s2.drills.tour.fast, false);
  play(s2, 'tour', 'C', T0, { level: 0 });
  assert.equal(s2.drills.tour.level, 2); assert.equal(s2.drills.tour.up, 0);
  // Exercice acquis : escalier gelé.
  const s3 = store();
  mastAt(s3, 'tour', 2, at(-7));
  play(s3, 'tour', 'F', at(0)); play(s3, 'tour', 'F F', at(0, 12));
  assert.equal(s3.drills.tour.level, 3);
});

test('Acquis : dernier palier, série complète, les deux couleurs si flip', () => {
  const s = store(), r = id => s.drills[id];
  // Un seul palier, flip, need 3.
  assert.equal(play(s, 'rr', 'C C C'), 'CCC');
  assert.equal(r('rr').st, 'learn', 'trois parties avec les Blancs ne suffisent pas');
  assert.equal(r('rr').var, 1);
  play(s, 'rr', 'Cb', at(0, 10));
  assert.equal(r('rr').st, 'acq'); assert.equal(r('rr').acqAt, at(0, 10));
  assert.equal(r('rr').box, 0); assert.equal(r('rr').due, at(0, 10) + DAY); assert.equal(r('rr').chk, P.dayStr(T0));
  // Sans flip : trois parties propres au dernier palier.
  play(s, 'oppo', 'C');
  assert.equal(r('oppo').level, 1);
  play(s, 'oppo', 'C C');
  assert.equal(r('oppo').st, 'learn');
  play(s, 'oppo', 'C');
  assert.equal(r('oppo').st, 'acq');
  // need 5 : cinq propres d'affilée au dernier palier ; un S casse la série.
  put(s, 'prise', { st: 'learn', level: 2, fast: false });
  play(s, 'prise', 'C Cb C Cb S C Cb C');
  assert.equal(r('prise').st, 'learn'); assert.equal(r('prise').streak, 3);
  play(s, 'prise', 'Cb');
  assert.equal(r('prise').st, 'learn');
  play(s, 'prise', 'C');
  assert.equal(r('prise').st, 'acq');
  // Palier inférieur au dernier : jamais acquis, même avec une longue série.
  put(s, 'tour', { st: 'learn', level: 2, fast: false, up: 0 });
  play(s, 'tour', 'C Cb', T0, { level: 2 });
  assert.equal(r('tour').st, 'learn');
  // Une position propre d'un palier plus facile ne compte pas pour la série, sans la casser.
  put(s, 'dame', { st: 'learn', level: 2, fast: false });
  play(s, 'dame', 'C Cb');
  play(s, 'dame', 'C', T0, { level: 0 });
  assert.equal(r('dame').streak, 2); assert.equal(r('dame').st, 'learn');
  play(s, 'dame', 'C');
  assert.equal(r('dame').st, 'acq');
  // Couleur de la position suivante.
  const sp = byId.rr;
  assert.deepEqual(P.setupFor(sp, { ...P.fresh(), st: 'learn', streak: 2, var: 1 }, () => 0), { level: 0, colour: 'b' }, 'couleur manquante imposée');
  assert.deepEqual(P.setupFor(sp, { ...P.fresh(), st: 'learn', streak: 3, var: 2 }, () => 0), { level: 0, colour: 'w' }, 'encore imposée au-delà de need − 1');
  assert.equal(P.setupFor(sp, { ...P.fresh(), st: 'learn', streak: 1, var: 1 }, () => 0.9).colour, 'b', 'sinon 50/50');
  assert.equal(P.setupFor(sp, { ...P.fresh(), st: 'learn', streak: 1, var: 1 }, () => 0.1).colour, 'w');
  assert.deepEqual(P.setupFor(byId.carre, { ...P.fresh(), st: 'learn', level: 0 }, () => 0.9), { level: 0, colour: 'b' }, 'sous le dernier palier : couleur canonique');
  assert.deepEqual(P.setupFor(byId.tour, { ...P.fresh(), st: 'acq', level: 1 }, () => 0.1), { level: 3, colour: 'w' }, 'acquis : dernier palier');
  assert.deepEqual(P.setupFor(byId.tour, null, () => 0.1), { level: 0, colour: 'w' });
});

// ---------- §4.3 ----------
test('Maîtrisé seulement un autre jour et au moins 12 h après Acquis', () => {
  const s = store(), r = () => s.drills.rr;
  play(s, 'rr', 'C Cb C', at(0, 22, 50));
  assert.equal(r().st, 'acq'); const acqAt = r().acqAt;
  play(s, 'rr', 'C', at(0, 23, 30));
  assert.equal(r().st, 'acq', 'le même jour : pas un contrôle');
  play(s, 'rr', 'C', at(1, 7));
  assert.equal(r().st, 'acq', 'le lendemain mais 8 h après : pas encore');
  assert.equal(r().chk, P.dayStr(at(1))); assert.equal(r().box, 0); assert.equal(r().due, at(1, 7) + DAY);
  play(s, 'rr', 'C', at(1, 20));
  assert.equal(r().st, 'acq', 'seconde partie du jour : pas un contrôle');
  play(s, 'rr', 'C', at(2, 9));
  assert.equal(r().st, 'mast'); assert.equal(r().mastAt, at(2, 9)); assert.equal(r().box, 1);
  assert.equal(r().due, at(2, 9) + 3 * DAY); assert.equal(r().acqAt, acqAt);
  // Cas simple : acquis à 9 h, propre le lendemain à 9 h.
  const s2 = store();
  play(s2, 'rr', 'C Cb C', at(0));
  play(s2, 'rr', 'C', at(1, 10));
  assert.equal(s2.drills.rr.st, 'mast');
});

test('seule la première partie du jour est un contrôle', () => {
  const s = store(), r = () => s.drills.tour;
  mastAt(s, 'tour', 1, at(-3));
  play(s, 'tour', 'C', at(0, 9));
  assert.equal(r().box, 2); assert.equal(r().due, at(0, 9) + 7 * DAY); assert.equal(r().lastChk, at(0, 9));
  play(s, 'tour', 'F', at(0, 18));
  assert.equal(r().st, 'mast', 'un échec plus tard dans la journée ne compte pas'); assert.equal(r().box, 2);
  assert.equal(r().streak, 0);
  // Contrôle trop tôt (moins de la moitié de l'intervalle) : propre, mais la boîte ne monte pas.
  play(s, 'tour', 'C', at(2));
  assert.equal(r().box, 2); assert.equal(r().due, at(2) + 7 * DAY);
  // S au contrôle : boîte inchangée, contrôle compté.
  play(s, 'tour', 'S', at(10));
  assert.equal(r().st, 'mast'); assert.equal(r().box, 2); assert.equal(r().chk, P.dayStr(at(10))); assert.equal(r().due, at(10) + 7 * DAY);
  // Le facteur aléatoire reste dans ±10 %.
  const s2 = store();
  mastAt(s2, 'tour', 3, at(-14));
  P.record(s2, byId.tour, attempt('C', { level: 3 }), T0, REG, { rng: () => 0 });
  assert.equal(s2.drills.tour.due, T0 + 30 * DAY * 0.9);
  P.record(s2, byId.tour, attempt('C', { level: 3 }), at(40), REG, { rng: () => 0.999999 });
  assert.ok(Math.abs(s2.drills.tour.due - (at(40) + 60 * DAY * 1.1)) < 5000);
});

test('raté → À reprendre → Maîtrisé avec need 2', () => {
  const s = store(), r = () => s.drills.tour;
  mastAt(s, 'tour', 3, at(-14), { streak: 4, var: 3 });
  play(s, 'tour', 'F', T0);
  assert.equal(r().st, 'rusty'); assert.equal(r().box, 1); assert.equal(r().need, 2); assert.equal(r().lapses, 1);
  assert.equal(r().streak, 0); assert.equal(r().level, 3);
  play(s, 'tour', 'C', at(0, 10));
  assert.equal(r().st, 'rusty');
  play(s, 'tour', 'S', at(0, 11));
  assert.equal(r().streak, 0);
  play(s, 'tour', 'Cb C', at(0, 12));
  assert.equal(r().st, 'mast'); assert.equal(r().box, 1, 'garde la boîte réduite'); assert.equal(r().need, null);
  assert.equal(r().due, at(0, 12) + 60e3 + 3 * DAY);
  // H ou A au contrôle : raté aussi.
  for (const code of ['H', 'A']) {
    const s2 = store();
    mastAt(s2, 'tour', 0, at(-1));
    play(s2, 'tour', code, T0);
    assert.equal(s2.drills.tour.st, 'rusty', code); assert.equal(s2.drills.tour.box, 0);
  }
  // Acquis raté au contrôle : retour « en cours » au dernier palier, need 2, escalier réactivé.
  const s3 = store(), r3 = () => s3.drills.dame;
  put(s3, 'dame', { st: 'acq', level: 2, fast: false, acqAt: at(-1), lastChk: at(-1), chk: P.dayStr(at(-1)), due: T0 });
  play(s3, 'dame', 'F', T0);
  assert.equal(r3().st, 'learn'); assert.equal(r3().need, 2); assert.equal(r3().level, 2, 'le raté lui-même ne fait pas descendre');
  play(s3, 'dame', 'C Cb', at(0, 10));
  assert.equal(r3().st, 'acq'); assert.equal(r3().acqAt, at(0, 10) + 60e3); assert.equal(r3().need, null);
  const s4 = store();
  put(s4, 'dame', { st: 'acq', level: 2, fast: false, acqAt: at(-1), lastChk: at(-1), chk: P.dayStr(at(-1)), due: T0 });
  play(s4, 'dame', 'F', T0); play(s4, 'dame', 'F', at(0, 10));
  assert.equal(s4.drills.dame.level, 1, 'ensuite, l’escalier joue de nouveau');
});

test('covers : révision implicite et placement', () => {
  // Placement : acquérir dame-pions valide dame (même nouvelle ou en cours).
  for (const before of [null, { st: 'learn', level: 0, streak: 1, var: 1 }]) {
    const s = store();
    if (before) put(s, 'dame', before);
    put(s, 'dame-pions', { st: 'learn', level: 2, fast: false });
    play(s, 'dame-pions', 'C Cb C', at(0, 15));
    const d = s.drills.dame;
    assert.equal(s.drills['dame-pions'].st, 'acq');
    assert.equal(d.st, 'acq'); assert.equal(d.placed, true); assert.equal(d.level, 2);
    assert.equal(d.chk, P.dayStr(at(0))); assert.equal(d.due, at(0, 15) + 120e3 + DAY);
    assert.equal(P.coveredByKnown(s, REG, 'dame'), true);
  }
  // Un exercice englobé « à reprendre » redevient maîtrisé.
  const s1 = store();
  put(s1, 'dame', { st: 'rusty', level: 2, box: 1, need: 2 });
  put(s1, 'dame-pions', { st: 'learn', level: 2, fast: false });
  play(s1, 'dame-pions', 'C Cb C');
  assert.equal(s1.drills.dame.st, 'mast'); assert.equal(s1.drills.dame.box, 1);
  // Révision implicite : une partie propre de dame-pions repousse le contrôle de dame.
  const s = store();
  mastAt(s, 'dame', 2, at(-6));                       // due dans 1 jour
  mastAt(s, 'dame-pions', 1, at(-1));
  play(s, 'dame-pions', 'C', T0);
  assert.equal(s.drills.dame.lastChk, T0); assert.equal(s.drills.dame.due, T0 + 7 * DAY);
  assert.equal(s.drills.dame.box, 2, 'pas de montée de boîte');
  const longDue = s.drills.dame.due = T0 + 20 * DAY;
  play(s, 'dame-pions', 'C', at(1));
  assert.equal(s.drills.dame.due, longDue, 'jamais avancé');
  play(s, 'dame-pions', 'S', at(2));
  assert.equal(s.drills.dame.lastChk, at(1), 'seule une partie propre compte');
  // Un exercice englobé par un exercice acquis n'est jamais programmé, même dû.
  s.drills.dame.due = T0;
  const plan = P.planSeance(s, REG, at(30), 3600);
  assert.ok(!plan.some(it => it.id === 'dame'));
  assert.ok(plan.some(it => it.id === 'dame-pions' && it.kind === 'controle'));
});

test('file des erreurs, meilleur score, journal, historique', () => {
  const s = store(), r = () => s.drills.tour;
  put(s, 'tour', { st: 'learn', level: 3, fast: false });
  const L = { level: 3 };
  P.record(s, byId.tour, attempt('F', { ...L, keyFen: 'f1', sub: 'x' }), T0, REG, OPT);
  P.record(s, byId.tour, attempt('S', { ...L, keyFen: 'f2' }), T0, REG, OPT);
  P.record(s, byId.tour, attempt('H', { ...L, keyFen: 'f3' }), T0, REG, OPT);
  assert.deepEqual(r().err, [{ fen: 'f1', level: 3, sub: 'x' }, { fen: 'f2', level: 3, sub: null }], 'F et S seulement');
  P.record(s, byId.tour, attempt('F', { ...L, keyFen: 'f1', sub: 'x' }), T0, REG, OPT);
  assert.deepEqual(r().err.map(e => e.fen), ['f2', 'f1'], 'sans doublon, la plus récente à la fin');
  for (let i = 0; i < 12; i++) P.record(s, byId.tour, attempt('F', { ...L, keyFen: `g${i}` }), T0, REG, OPT);
  assert.equal(r().err.length, 10); assert.equal(r().err[0].fen, 'g2'); assert.equal(r().err.at(-1).fen, 'g11');
  P.record(s, byId.tour, attempt('C', { ...L, fromErr: 'g5' }), T0, REG, OPT);
  assert.ok(!r().err.some(e => e.fen === 'g5'), 'une erreur rejouée proprement sort de la file');
  P.record(s, byId.tour, attempt('S', { ...L, fromErr: 'g6' }), T0, REG, OPT);
  assert.ok(r().err.some(e => e.fen === 'g6'));
  // Meilleur score : parties propres au dernier palier seulement.
  const s2 = store();
  put(s2, 'tour', { st: 'learn', level: 3, fast: false });
  P.record(s2, byId.tour, attempt('C', { level: 3, moves: 12 }), T0, REG, OPT);
  P.record(s2, byId.tour, attempt('C', { level: 3, moves: 9 }), T0, REG, OPT);
  P.record(s2, byId.tour, attempt('C', { level: 3, moves: 11 }), T0, REG, OPT);
  P.record(s2, byId.tour, attempt('C', { level: 1, moves: 3 }), T0, REG, OPT);
  P.record(s2, byId.tour, attempt('S', { level: 3, moves: 4 }), T0, REG, OPT);
  assert.equal(s2.drills.tour.best, 9);
  // Compteurs et journal.
  const s3 = store();
  assert.equal(P.record(s3, byId.rr, attempt('R'), T0, REG, OPT), 'R');
  assert.equal(s3.drills.rr, undefined, 'R : journal seulement');
  assert.equal(s3.log.length, 1); assert.deepEqual(s3.log[0], [T0, 'rr', 'R', 0, 10, 8, 0, 60, 'w']);
  assert.equal(P.record(s3, byId.rr, attempt('A', { moves: 0 }), T0, REG, OPT), null);
  assert.equal(s3.log.length, 1, 'abandon avant le premier coup : rien du tout');
  play(s3, 'rr', 'C S H F A');
  assert.deepEqual({ n: s3.drills.rr.n, ok: s3.drills.rr.ok, clean: s3.drills.rr.clean, hist: s3.drills.rr.hist }, { n: 5, ok: 3, clean: 1, hist: 'CSHFA' });
  assert.deepEqual(s3.log.at(-2), [T0 + 3 * 60e3, 'rr', 'F', 0, 10, 8, 0, 60, 'w']);
  assert.equal(s3.log.at(-3)[6], 1, 'indices notés');
  play(s3, 'rr', 'R');
  assert.equal(s3.drills.rr.n, 5); assert.equal(s3.drills.rr.hist, 'CSHFA');
  for (let i = 0; i < 30; i++) play(s3, 'rr', 'S');
  assert.equal(s3.drills.rr.hist.length, 20);
  for (let i = 0; i < 300; i++) P.record(s3, byId.rr, attempt('S', { secs: i }), T0 + i, REG, OPT);
  assert.equal(s3.log.length, 300); assert.equal(s3.log.at(-1)[7], 299); assert.equal(s3.log[0][7], 0);
  assert.equal(s3.drills.rr.last, T0 + 299);
});

test('fin de bloc après trois échecs de suite', () => {
  const s = store();
  put(s, 'tour', { st: 'learn', level: 3, fast: false });
  play(s, 'tour', 'F');
  assert.equal(P.focusBreak(s, byId.tour, 1), null);
  play(s, 'tour', 'F F');
  assert.equal(s.drills.tour.level, 0);
  assert.match(P.focusBreak(s, byId.tour, 3), /trois échecs de suite/);
  assert.equal(s.drills.tour.level, 0, 'jamais sous le premier palier');
  put(s, 'dame', { st: 'learn', level: 2, fast: false, hist: 'CFF' });
  play(s, 'dame', 'F');
  assert.equal(s.drills.dame.level, 1);
  assert.ok(P.focusBreak(s, byId.dame, 4)); assert.equal(s.drills.dame.level, 0, 'un palier de plus');
  assert.ok(P.focusBreak(s, byId.dame, 4)); assert.equal(s.drills.dame.level, 0, 'une seule fois');
  assert.equal(P.focusBreak(s, byId.dame, 2), null, 'pas avant trois parties dans le bloc');
});

// ---------- §1.8 Migration ----------
const V1 = {
  champion: { finales: { kqk: { tries: 9, wins: 7, perfect: 3 }, krk: { tries: 12, wins: 10, perfect: 5 } }, menace: {}, puzzles: {}, days: { '2026-10-01': 3 } },
  moyen: { finales: { krk: { tries: 5, wins: 2, perfect: 1 }, krrk: { tries: 3, wins: 3, perfect: 2 } }, menace: { m1: { n: 2, ok: 1, box: 1, last: 5 } }, puzzles: {}, days: {} },
  debutant: { finales: { krk: { tries: 4, wins: 0 }, kqk: { tries: 0, wins: 0 } }, menace: {}, puzzles: { p9: { n: 1, ok: 0, box: 0, last: 7 } }, days: { '2026-09-30': 1 }, stats: { menace: { done: 4, spotted: 2, parried: 1 } } },
};
const clone = o => JSON.parse(JSON.stringify(o));
const MATS = { 'mat-deux-tours': mk('mat-deux-tours', 'mats', 1), 'mat-dame': mk('mat-dame', 'mats', 3), 'mat-tour': mk('mat-tour', 'mats', 4) };
const MREG = { byId: MATS, list: Object.values(MATS), parcours: Object.keys(MATS), coveredBy: {} };

test('migration de trois profils v1', () => {
  // Champion : ≥ 3 parties parfaites → acquis, contrôle dû dès la première séance, une partie propre → Maîtrisé.
  const a = P.migrate(clone(V1.champion), T0);
  assert.equal(a.v, 2); assert.deepEqual(a.log, []); assert.deepEqual(a.prefs, {});
  for (const [id, n, ok, clean, lvl] of [['mat-dame', 9, 7, 3, 2], ['mat-tour', 12, 10, 5, 3]]) {
    const d = a.drills[id];
    assert.equal(d.st, 'acq', id); assert.equal(d.level, lvl); assert.equal(d.fast, false);
    assert.deepEqual([d.n, d.ok, d.clean], [n, ok, clean]);
    assert.equal(d.due, T0); assert.equal(d.acqAt, T0 - DAY); assert.equal(d.lastChk, T0 - DAY);
  }
  assert.equal(a.drills['mat-deux-tours'], undefined);
  assert.deepEqual(a.finales, V1.champion.finales, 'v1 gelé, gardé pour un retour arrière');
  const plan = P.planSeance(a, MREG, T0 + 60e3, 3600);
  assert.deepEqual(plan.filter(it => it.kind === 'controle').map(it => it.id).sort(), ['mat-dame', 'mat-tour']);
  P.record(a, MATS['mat-dame'], attempt('C', { level: 2 }), T0 + 60e3, MREG, OPT);
  assert.equal(a.drills['mat-dame'].st, 'mast'); assert.equal(a.drills['mat-dame'].box, 1);
  // Moyen : quelques victoires → en cours, un palier sous le dernier, voie rapide.
  const b = P.migrate(clone(V1.moyen), T0);
  assert.deepEqual(['st', 'level', 'fast'].map(k => b.drills['mat-tour'][k]), ['learn', 2, true]);
  assert.deepEqual(['st', 'level', 'fast'].map(k => b.drills['mat-deux-tours'][k]), ['learn', 0, true]);
  assert.equal(b.drills['mat-deux-tours'].clean, 2);
  assert.deepEqual(b.menace, V1.moyen.menace);
  // Débutant : aucune victoire → premier palier ; aucun essai → pas de fiche.
  const c = P.migrate(clone(V1.debutant), T0);
  assert.deepEqual(['st', 'level', 'fast', 'n', 'ok'].map(k => c.drills['mat-tour'][k]), ['learn', 0, true, 4, 0]);
  assert.equal(c.drills['mat-dame'], undefined);
  for (const k of ['menace', 'puzzles', 'days', 'stats']) assert.deepEqual(c[k], V1.debutant[k], k);
  // Idempotente, et n'écrase jamais une fiche v2.
  const again = P.migrate(clone(c), at(5));
  assert.deepEqual(again, c);
  const mixed = clone(V1.champion); mixed.drills = { 'mat-dame': { ...P.fresh(), st: 'mast', box: 4 } };
  P.migrate(mixed, T0);
  assert.equal(mixed.drills['mat-dame'].st, 'mast'); assert.equal(mixed.drills['mat-tour'].st, 'acq');
  // Fiche incomplète (ancienne version) : complétée sans rien perdre.
  const partial = P.migrate({ v: 2, drills: { 'mat-tour': { st: 'learn', level: 1, n: 3 } } }, T0);
  assert.equal(partial.drills['mat-tour'].level, 1); assert.deepEqual(partial.drills['mat-tour'].err, []);
  assert.equal(partial.drills['mat-tour'].hist, ''); assert.deepEqual(partial.log, []);
  assert.equal(P.migrate(null), null);
});

test('import d’un fichier exporté en v1 (util.js)', async () => {
  const mem = new Map();
  globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  try {
    // Chargement d'un magasin v1 déjà présent dans le navigateur.
    mem.set('manuel-echecs-v1', JSON.stringify(V1.debutant));
    const U1 = await import('../../js/util.js?load');
    const s = U1.load();
    assert.equal(s.v, 2); assert.equal(s.drills['mat-tour'].st, 'learn');
    assert.deepEqual(s.stats, V1.debutant.stats); assert.deepEqual(s.finales, V1.debutant.finales);
    U1.recordResult('menace', 'q1', true);
    assert.equal(U1.load().menace.q1.ok, 1, 'les rubriques v1 marchent toujours');
    assert.equal(Object.values(U1.load().days).reduce((a, b) => a + b, 0), 2);
    // Import d'une sauvegarde v1 (sans stats) dans une autre session.
    const U = await import('../../js/util.js?import');
    U.importProgress(JSON.stringify(V1.champion));
    const t = U.load();
    assert.equal(t.v, 2); assert.equal(t.drills['mat-dame'].st, 'acq'); assert.equal(t.drills['mat-tour'].level, 3);
    for (const k of ['finales', 'menace', 'puzzles', 'days', 'stats', 'drills', 'log', 'prefs']) assert.ok(t[k] && typeof t[k] === 'object', k);
    assert.equal(JSON.parse(mem.get('manuel-echecs-v1')).v, 2, 'enregistré migré');
    // L'export se réimporte à l'identique.
    const out = U.exportProgress();
    U.importProgress(out);
    assert.deepEqual(U.load(), JSON.parse(out));
    // Fichiers invalides : erreur, magasin intact.
    for (const bad of ['[]', '3', 'null', '{oops']) assert.throws(() => U.importProgress(bad));
    assert.equal(U.load().drills['mat-dame'].st, 'acq');
    U.resetProgress();
    assert.deepEqual(Object.keys(U.load().drills), []); assert.equal(U.load().v, 2); assert.deepEqual(U.load().finales, {});
  } finally { delete globalThis.localStorage; }
});

// ---------- §4.5 et §4.6 ----------
test('prérequis, recommandé, « Tu es ici », étape suivante', () => {
  const s = store();
  assert.equal(P.prereqOk(s, REG, 'oppo'), false); assert.equal(P.isRecommended(s, REG, 'oppo'), false);
  assert.equal(P.gateText(s, REG, 'oppo'), 'Il te manque : La règle du carré. Essayer quand même ?');
  assert.equal(P.hereId(s, REG), 'rr');
  put(s, 'oppo', { st: 'learn' });
  assert.equal(P.isRecommended(s, REG, 'oppo'), true, 'déjà commencé');
  put(s, 'carre', { st: 'rusty' });
  assert.equal(P.prereqOk(s, REG, 'oppo'), true, 'à reprendre compte comme acquis');
  assert.equal(P.gateText(s, REG, 'oppo'), '');
  put(s, 'rr', { st: 'acq' });
  assert.equal(P.hereId(s, REG), 'dame');
  assert.deepEqual(P.nextStep(s, REG, 'rr'), { kind: 'next', id: 'dame', title: 'Mat avec la dame', label: 'Passer à Mat avec la dame', stay: 'Continuer ici', text: 'Prochaine étape : Mat avec la dame' });
  assert.deepEqual(P.nextStep(s, REG, 'oppo'), { kind: 'same', id: 'oppo', label: 'Position suivante' });
  assert.equal(P.nextStep(s, REG, 'rr', { seance: true }).label, 'Suite de la séance');
  assert.equal(P.missingPrereqs(s, { ...REG, byId: { ...byId, x: mk('x', 'mats', 1, { prereq: ['inconnu'] }) } }, 'x').length, 0, 'prérequis hors catalogue ignorés');
});

const kinds = plan => plan.map(it => `${it.kind}${it.id ? ':' + it.id : ''}`);
test('séance du jour : six scénarios', () => {
  const NOW = at(30);
  // 1. Profil vierge : une nouveauté, rien d'autre.
  const s1 = store();
  assert.deepEqual(P.planSeance(s1, REG, NOW), [{ kind: 'nouveau', id: 'rr', n: 3, secs: 360 }]);

  // 2. À mi-chemin : un exercice en cours → bloc + nouveauté conseillée (prérequis respectés) ; deux en cours → bloc seul.
  const s2 = store();
  put(s2, 'rr', { st: 'acq', level: 0, due: NOW + DAY, lastChk: NOW - DAY, chk: P.dayStr(NOW - DAY) });
  put(s2, 'prise', { st: 'learn', level: 1 });
  const p2 = P.planSeance(s2, REG, NOW, 3600);
  assert.deepEqual(kinds(p2), ['focus:prise', 'nouveau:dame']);
  assert.deepEqual(p2[0], { kind: 'focus', id: 'prise', n: 6, until: 'acq', secs: 270 });
  put(s2, 'tour', { st: 'learn', level: 2 }); put(s2, 'dame', { st: 'learn' });
  assert.deepEqual(kinds(P.planSeance(s2, REG, NOW, 3600)), ['focus:dame'], 'le plus tôt dans le parcours, pas de nouveauté');
  const s2b = store();
  for (const id of ['rr', 'dame', 'prise', 'tour', 'couloir']) put(s2b, id, { st: 'acq', due: NOW + DAY });
  assert.equal(P.planSeance(s2b, REG, NOW, 3600).find(it => it.kind === 'nouveau').id, 'carre', 'fourche attend prise… acquise, mais carre vient avant');
  put(s2b, 'prise', { st: 'new' }); put(s2b, 'carre', { st: 'acq', due: NOW + DAY });
  assert.equal(P.planSeance(s2b, REG, NOW, 3600).find(it => it.kind === 'nouveau').id, 'prise');

  // 3. Cinq contrôles dus : trois au plus, par retard relatif, jamais deux du même parcours d'affilée.
  const s3 = store();
  mastAt(s3, 'rr', 0, NOW - 10 * DAY);        // retard relatif 10
  mastAt(s3, 'dame', 1, NOW - 15 * DAY);      // 5
  mastAt(s3, 'carre', 1, NOW - 12 * DAY);     // 4
  mastAt(s3, 'tour', 2, NOW - 21 * DAY);      // 3
  mastAt(s3, 'prise', 2, NOW - 8 * DAY);      // 1,14
  mastAt(s3, 'couloir', 0, NOW - 3 * DAY, { chk: P.dayStr(NOW) });  // déjà contrôlé aujourd'hui
  put(s3, 'futur', { st: 'mast', due: 0, lastChk: NOW - 50 * DAY });  // phase B : jamais programmé
  const p3 = P.planSeance(s3, REG, NOW, 3600);
  assert.deepEqual(kinds(p3), ['controle:rr', 'controle:carre', 'controle:dame', 'nouveau:oppo', 'melange']);
  assert.deepEqual(p3[0], { kind: 'controle', id: 'rr', n: 2, secs: 240 });
  assert.equal(p3.at(-1).n, 2, 'mélange : max(2, 5 − 3)');
  // Trois du même parcours : impossible à séparer, l'ordre de priorité reste.
  for (const id of ['carre', 'prise']) delete s3.drills[id];
  assert.deepEqual(kinds(P.planSeance(s3, REG, NOW, 3600)).slice(0, 3), ['controle:rr', 'controle:dame', 'controle:tour']);
  assert.deepEqual(P.interleaveByTrack([{ t: 'a' }, { t: 'b' }, { t: 'b' }], x => x.t).map(x => x.t), ['b', 'a', 'b']);
  assert.deepEqual(P.interleaveByTrack([{ t: 'a' }, { t: 'a' }, { t: 'b' }], x => x.t).map(x => x.t), ['a', 'b', 'a']);
  assert.deepEqual(P.interleaveByTrack([{ t: 'a', i: 1 }, { t: 'b', i: 2 }, { t: 'c', i: 3 }], x => x.t).map(x => x.i), [1, 2, 3]);

  // 4. À reprendre : en tête, quel que soit le retard, n 4 jusqu'à Maîtrisé.
  const s4 = store();
  mastAt(s4, 'rr', 0, NOW - 10 * DAY);
  put(s4, 'carre', { st: 'rusty', level: 1, box: 0, need: 2, lastChk: NOW - 1000, chk: P.dayStr(NOW), due: NOW + DAY });
  const p4 = P.planSeance(s4, REG, NOW, 3600);
  assert.deepEqual(p4[0], { kind: 'reprise', id: 'carre', n: 4, until: 'mast', secs: 480 });
  assert.deepEqual(kinds(p4), ['reprise:carre', 'controle:rr', 'nouveau:dame']);

  // 5. Au moins trois exercices connus : mélange (n = 5 sans contrôle) ; deux ne suffisent pas.
  const s5 = store();
  for (const id of ['rr', 'dame', 'carre']) mastAt(s5, id, 2, NOW - DAY);
  assert.deepEqual(P.planSeance(s5, REG, NOW, 3600).at(-1), { kind: 'melange', n: 5, secs: 600 });
  delete s5.drills.carre;
  assert.ok(!P.planSeance(s5, REG, NOW, 3600).some(it => it.kind === 'melange'));
  put(s5, 'dame-pions', { st: 'acq', level: 2, due: NOW + DAY, lastChk: NOW - DAY, chk: P.dayStr(NOW - DAY) });
  assert.deepEqual(P.melangePool(s5, REG).map(d => d.id), ['rr', 'dame-pions'], 'dame englobée : hors du mélange');
  assert.ok(P.planSeance(s5, REG, NOW, 3600).some(it => it.kind === 'melange'));

  // 6. Budget : on raccourcit, puis on retire mélange, nouveauté, contrôles en trop ; le premier reste.
  const s6 = store();
  mastAt(s6, 'rr', 0, NOW - 10 * DAY); mastAt(s6, 'carre', 1, NOW - 9 * DAY); mastAt(s6, 'couloir', 1, NOW - 5 * DAY);
  put(s6, 'dame', { st: 'learn', level: 1 });
  const full = P.planSeance(s6, REG, NOW, 1e6);
  assert.deepEqual(kinds(full), ['controle:rr', 'controle:carre', 'controle:couloir', 'focus:dame', 'nouveau:prise', 'melange']);
  const p6 = P.planSeance(s6, REG, NOW);                                           // 15 min
  const total = p => p.reduce((t, it) => t + it.secs, 0);
  assert.equal(total(full), 1615);
  assert.ok(total(p6) <= 900, `budget tenu (${total(p6)} s)`);
  assert.deepEqual(kinds(p6), ['controle:rr', 'controle:carre', 'controle:couloir', 'focus:dame', 'nouveau:prise'], 'mélange retiré');
  assert.deepEqual(p6.map(it => it.n), [1, 1, 1, 4, 2], 'raccourcis d’abord');
  assert.deepEqual(kinds(P.planSeance(s6, REG, NOW, 600)), ['controle:rr', 'controle:carre', 'focus:dame'], 'puis nouveauté et contrôles en trop');
  const tiny = P.planSeance(s6, REG, NOW, 30);
  assert.deepEqual(kinds(tiny), ['controle:rr'], 'jamais vide');
  // Durées tirées du journal (médiane) : tout tient.
  for (const id of ['rr', 'carre', 'couloir', 'dame', 'prise']) for (const secs of [20, 30, 400]) s6.log.push([NOW - DAY, id, 'C', 0, 5, 5, 0, secs, 'w']);
  assert.equal(P.estimateSecs(s6, REG, 'rr'), 30);
  assert.equal(P.estimateSecs(s6, REG, 'oppo'), 120); assert.equal(P.estimateSecs(s6, REG, 'fourche'), 45);
  assert.deepEqual(P.planSeance(s6, REG, NOW).map(it => it.n), [2, 2, 2, 6, 3, 2]);
});

// ---------- §4.7 ----------
test('mélange : poids, contraste, jamais deux fois le même parcours', () => {
  const NOW = at(30), s = store();
  for (const id of ['rr', 'dame', 'carre', 'couloir', 'parer']) mastAt(s, id, 1, NOW - 3 * DAY);
  s.drills.rr.lastChk = NOW - 30 * DAY;                // très en retard → poids 3 (plafond)
  assert.equal(P.melangeWeight(s.drills.rr, NOW), 3);
  assert.equal(P.melangeWeight({ ...s.drills.dame, lastChk: NOW }, NOW), 0.3);
  assert.equal(P.melangeWeight(s.drills.dame, NOW), 1);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let prev = null, contrast = 0, fromCouloir = 0;
  for (let i = 0; i < 400; i++) {
    const id = P.pickMelange(s, REG, prev, rnd, NOW);
    assert.ok(id && byId[id].phase === 'A');
    if (prev === 'couloir') { fromCouloir++; if (id === 'parer') contrast++; }
    if (prev && !(byId[prev].contrast || []).includes(id)) assert.notEqual(byId[id].track, byId[prev].track, `${prev} → ${id}`);
    prev = id;
  }
  assert.ok(contrast / fromCouloir > 0.4, `contraste une fois sur deux environ (${contrast}/${fromCouloir})`);
  assert.equal(P.pickMelange(store(), REG, null, rnd, NOW), null);
});

// ---------- Textes ----------
test('textes : échéances, états, série, bilan', () => {
  assert.equal(P.dueLabel(at(0, 18), at(0, 9)), 'aujourd’hui');
  assert.equal(P.dueLabel(at(-3), at(0)), 'aujourd’hui', 'en retard');
  assert.equal(P.dueLabel(at(1, 1), at(0, 23)), 'demain');
  assert.equal(P.dueLabel(at(2), at(0)), 'jeudi');
  assert.equal(P.dueLabel(at(6), at(0)), 'lundi');
  assert.equal(P.dueLabel(at(12), at(0)), 'dans 12 jours');
  assert.deepEqual(['new', 'learn', 'acq', 'mast', 'rusty', undefined].map(P.stateLabel), ['Nouveau', 'En cours', 'Acquis', 'Maîtrisé', 'À reprendre', 'Nouveau']);
  assert.equal(P.streakDots({ streak: 2 }, 3), '●●○'); assert.equal(P.streakDots({ streak: 7 }, 5), '●●●●●');
  assert.equal(P.streakDots(null, 3), '○○○'); assert.equal(P.streakDots({ streak: 1, need: 2 }), '●○');
  assert.equal(P.dayStr(at(0, 23, 59)), '2026-10-06');

  // Bilans, en rejouant de vraies séquences.
  const sp = { ...byId.rr, goal: { kind: 'mate' } };
  const s = store(), go = (code, o = {}, now = T0) => {
    const before = s.drills.rr ? { ...s.drills.rr } : null;
    const a = attempt(code, { level: 0, ...o });
    const c = P.record(s, sp, a, now, REG, OPT);
    return P.resultText({ spec: sp, code: c, attempt: a, before, after: s.drills.rr, now });
  };
  assert.equal(go('C', { moves: 13, ref: 12 }), 'Mat en 13 coups (référence 12). Propre. Série : 1 sur 3.');
  assert.equal(go('S', { moves: 19, ref: 12 }), 'Mat en 19 coups (référence 12, limite 15). Réussi, pas encore propre.');
  assert.equal(go('H'), 'Réussi avec indice. L’indice ne coûte que la série, pas le palier.');
  assert.equal(go('C', { moves: 13, ref: 12 }), 'Mat en 13 coups (référence 12). Propre. Série : 1 sur 3.');
  assert.equal(go('C', { moves: 13, ref: 12 }), 'Mat en 13 coups (référence 12). Propre. Série : 2 sur 3. La prochaine se joue avec les Noirs.');
  assert.equal(go('C', { moves: 9, ref: 9, color: 'b' }), 'Mat en 9 coups (référence 9). Acquis : 3 parties propres d’affilée. On revérifie demain.');
  assert.equal(go('C', { moves: 9, ref: 9 }, at(1, 10)), 'Mat en 9 coups (référence 9). Maîtrisé : toujours propre après une nuit. Prochain contrôle samedi.');
  assert.equal(go('C', { moves: 9, ref: 9 }, at(1, 11)), 'Mat en 9 coups (référence 9). Propre.');
  assert.equal(go('F', {}, at(5)), 'À reprendre : 2 parties propres d’affilée suffiront.');
  assert.equal(go('C', { ref: null, moves: 7 }, at(5, 10)), 'Mat en 7 coups. Propre. Série : 1 sur 2. La prochaine se joue avec les Noirs.');
  assert.match(go('C', { color: 'b', ref: null }, at(5, 11)), /Maîtrisé à nouveau\. Prochain contrôle (lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|demain)\.$/);
  assert.match(go('C', {}, at(20)), /^Mat en 10 coups \(référence 8\)\. Propre : contrôle réussi\. Prochain contrôle /);
  assert.match(go('S', {}, at(40)), /Réussi, pas encore propre : l’intervalle ne s’allonge pas\. Prochain contrôle/);
  assert.equal(go('R'), 'Hors série : cette partie ne compte pas pour la progression.');
  // Escalier : palier suivant, compteur, retour en arrière ; mat en n ; contrôle trop tôt ; markdown.
  const s2 = store(), T = byId.tour, go2 = (code, o = {}, now = T0) => {
    const before = s2.drills.tour ? { ...s2.drills.tour } : null;
    const a = attempt(code, { level: s2.drills.tour?.level ?? 0, ...o });
    const c = P.record(s2, T, a, now, REG, OPT);
    return P.resultText({ spec: T, code: c, attempt: a, before, after: s2.drills.tour, now, md: true });
  };
  assert.equal(go2('C'), 'Mat en 10 coups (référence 8). **Propre**. Palier suivant : Palier 2 (2/4).');
  assert.equal(go2('F'), 'Retour au palier 1/4 pour consolider.');
  assert.equal(go2('C'), 'Mat en 10 coups (référence 8). **Propre**. Encore 2 parties propres pour passer au palier suivant.');
  assert.equal(go2('C'), 'Mat en 10 coups (référence 8). **Propre**. Encore 1 partie propre pour passer au palier suivant.');
  const mn = { ...byId.couloir };
  assert.equal(P.resultText({ spec: mn, code: 'S', attempt: { moves: 3 } }), 'Mat en 3 coups au lieu de 1. Réussi, pas encore propre.');
  const s3 = store();
  put(s3, 'rr', { st: 'acq', acqAt: at(0, 23), lastChk: at(0, 23), chk: P.dayStr(at(0)), due: at(1, 23) });
  const b3 = { ...s3.drills.rr };
  P.record(s3, byId.rr, attempt('C'), at(1, 7), REG, OPT);
  assert.equal(P.resultText({ spec: byId.rr, code: 'C', attempt: attempt('C'), before: b3, after: s3.drills.rr, now: at(1, 7) }),
    'Mat en 10 coups (référence 8). Propre. Le contrôle compte après une nuit : on revérifie demain.');
  // Placement signalé quand le magasin et le registre sont fournis ; raté d'un acquis.
  const s4 = store();
  put(s4, 'dame-pions', { st: 'learn', level: 2, fast: false, streak: 2, var: 1 });
  const b4 = { ...s4.drills['dame-pions'] };
  P.record(s4, byId['dame-pions'], attempt('C', { level: 2, color: 'b' }), T0, REG, OPT);
  assert.match(P.resultText({ spec: byId['dame-pions'], code: 'C', attempt: attempt('C'), before: b4, after: s4.drills['dame-pions'], now: T0, store: s4, reg: REG }),
    /Acquis : 3 parties propres d’affilée\. On revérifie demain\. Validé du même coup : Mat avec la dame\.$/);
  const b5 = { ...s4.drills['dame-pions'] };
  P.record(s4, byId['dame-pions'], attempt('H', { level: 2 }), at(1), REG, OPT);
  assert.equal(P.resultText({ spec: byId['dame-pions'], code: 'H', attempt: attempt('H'), before: b5, after: s4.drills['dame-pions'], now: at(1) }),
    'Réussi avec indice : un contrôle se passe sans aide. Contrôle manqué : 2 parties propres d’affilée suffiront pour le retrouver.');
  // Aucune faute typographique classique.
  for (const t of [P.gateText(store(), REG, 'oppo'), P.nextDueText(s4, REG, T0)]) assert.ok(!/ {2}|undefined|NaN/.test(t), t);
});

test('synthèses : comptes par état, prochain contrôle', () => {
  const NOW = at(30), s = store();
  mastAt(s, 'rr', 0, NOW - 2 * DAY);                       // dû
  mastAt(s, 'dame', 2, NOW - DAY);                         // pas dû (englobé de toute façon)
  put(s, 'dame-pions', { st: 'acq', level: 2, due: NOW + 2 * DAY, lastChk: NOW, chk: P.dayStr(NOW - DAY) });
  put(s, 'carre', { st: 'rusty', level: 1 });
  put(s, 'tour', { st: 'learn', level: 1 });
  put(s, 'futur', { st: 'learn' });
  const sum = P.trackSummary(s, REG, NOW);
  assert.deepEqual({ total: sum.total, new: sum.new, learn: sum.learn, acq: sum.acq, mast: sum.mast, rusty: sum.rusty, due: sum.due, review: sum.review, known: sum.known },
    { total: 11, new: 5, learn: 2, acq: 1, mast: 2, rusty: 1, due: 1, review: 2, known: 4 });
  assert.deepEqual([sum.tracks.mats.mast, sum.tracks.pions.rusty, sum.tracks.tactique.new], [2, 1, 2]);
  assert.equal(P.nextDueText(s, REG, NOW), 'Prochain contrôle : aujourd’hui (1 exercice).');
  s.drills.rr.due = NOW + 2 * DAY + 3600e3;
  assert.equal(P.nextDueText(s, REG, NOW), `Prochain contrôle : ${P.dueLabel(NOW + 2 * DAY, NOW)} (2 exercices).`);
  assert.equal(P.nextDueText(store(), REG, NOW), '');
});

test('le vrai catalogue : migration et séance cohérentes', async t => {
  let reg;
  try { reg = (await import('../../js/drills/index.js')).REGISTRY; } catch (e) { t.skip(`catalogue indisponible : ${e.message}`); return; }
  for (const [id, top] of Object.values(P.MIGRATE_MAP)) {
    if (reg.byId[id]) assert.equal(reg.byId[id].levels.length - 1, top, `${id} : dernier palier`);
  }
  const s = store();
  assert.deepEqual(P.planSeance(s, reg, T0), [{ kind: 'nouveau', id: reg.parcours[0], n: 3, secs: P.estimateSecs(s, reg, reg.parcours[0]) * 3 }]);
  const m = P.migrate(clone(V1.champion), T0);
  P.record(m, reg.byId['mat-dame'], attempt('C', { level: 2 }), T0 + 60e3, reg, OPT);
  assert.equal(m.drills['mat-dame'].st, 'mast');
  assert.ok(Number.isFinite(P.trackSummary(m, reg, T0).known));
});
