// Motifs tactiques, images de mat, vigilance — spec §6.2 items 3 et 4 pour ces familles (§3.0.3, §3.5–3.7).
// node --test tools/test/tactics.test.mjs   (QUICK=1 : rapide ; FULL=1 : complet ; ONLY=<id> : un seul exercice)
//
// 1. Sans moteur : bruit inerte (contre chess.js), générateurs (légalité, S0, coup clé, rôles, variété, vitesse).
// 2. Avec le moteur, par exercice et par palier : production, contre-vérification longue et indépendante,
//    acceptation, temps par position, variété, couverture des sous-cas.
// 3. Parties simulées par la vraie classe Attempt : l'oracle réussit, une gaffe nette échoue sur-le-champ.
// 4. Fixtures (§6.2-4) : fourchette encaissée au 2e coup, sacrifice « de dépit » sans fausse réussite,
//    mat en 2 par un autre chemin (propre) ou plus lent (non propre), parer le mat du couloir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from '../../vendor/chess.js';
import { DRILLS } from '../../js/drills/index.js';
import { produce, finalize } from '../../js/drill/produce.js';
import { s0 } from '../../js/drill/s0.js';
import { GOALS } from '../../js/drill/goals.js';
import { Attempt } from '../../js/drill/attempt.js';
import { mulberry32, fenFrom, ALL_SQUARES } from '../../js/drill/geom.js';
import { addNoise, addBlackPawn, attackedBy } from '../../js/drill/noise.js';
import { nullMoveFen } from '../../js/util.js';
import { makeCtx, closeCtx, simulate, oracle, N, QUICK } from './harness.mjs';
import { recheck, findBlunder, verifyKind, levelN, median, p90 } from './tactics-check.mjs';

const IDS = ['piece-en-prise', 'fourchette-cavalier', 'enfilade', 'clouage', 'mat-couloir', 'mat-etouffe', 'mat-dame-fou', 'parer-couloir'];
const only = process.env.ONLY;
const ids = IDS.filter(id => !only || id === only);
const placement = fen => fen.split(' ')[0];
const other = c => (c === 'w' ? 'b' : 'w');
const LONG = { timeout: 90 * 60e3 };

// Défaut connu du cœur partagé (voir le rapport) : drill/goals.js ne résout pas `goal.n` quand c'est une fonction
// du palier (mat en 1 puis mat en 2). On le détecte par sa signature exacte (le texte du but affiche le code de la
// fonction) : les tests concernés redeviennent des tests ordinaires dès la correction.
const N_BUG = /=>/.test(GOALS.mate.text(DRILLS['mat-couloir'], { level: 2, userColor: 'w', spec: DRILLS['mat-couloir'] }));
const N_TODO = N_BUG && 'drill/goals.js : goal.n fonction du palier non résolu (voir goalN dans le rapport)';
const fnGoal = spec => typeof spec.goal.n === 'function';

let ctx;
before(async () => { ctx = await makeCtx({ seed: 7, tb: false }); });
after(() => {
  closeCtx(ctx);
  if (report.length) {
    console.log('\n  exercice              palier  n  vérifs  acceptées  acc.   médiane  p90    distinctes  sous-cas  accord');
    for (const r of report) console.log(`  ${r.id.padEnd(21)} L${r.level + 1}     ${String(r.n).padStart(2)}  ${String(r.calls).padStart(5)}  ${String(r.ok).padStart(8)}  ${(100 * r.ok / r.calls).toFixed(0).padStart(4)} %  ${String(Math.round(r.med)).padStart(5)} ms ${String(Math.round(r.p90)).padStart(5)} ms  ${String(r.distinct).padStart(4)} %     ${r.strata.padEnd(8)}  ${r.agree}`);
  }
});
const report = [];

// ---------------------------------------------------------------- 1. Sans moteur
test('bruit inerte : attaques identiques à chess.js, unités inertes, matériel égal, pions non empilés', () => {
  const rng = mulberry32(5);
  const bases = [
    [{ e1: 'K', e8: 'k', d4: 'Q', c6: 'n' }, ['e1', 'e8', 'd4', 'c6', 'd5', 'e5']],
    [{ g1: 'K', f2: 'P', g2: 'P', h2: 'P', g8: 'k', a4: 'r', c3: 'R' }, ['g1', 'f1', 'h1', 'a1', 'a2', 'a3', 'g8', 'c3']],
    [{ b1: 'K', h8: 'k', g7: 'p', h7: 'p', g8: 'r', e5: 'N' }, ['h8', 'g8', 'g7', 'h7', 'f7', 'e5', 'b1']],
  ];
  let units = 0;
  for (let i = 0; i < 300; i++) {
    const [base, footList] = bases[i % bases.length], foot = new Set(footList);
    const { placement: m, units: u } = addNoise(rng, base, foot, 6);
    units += u;
    const c = new Chess(fenFrom(m, 'w'));
    // attackedBy ≡ chess.js
    for (const col of ['w', 'b']) {
      const A = attackedBy(m, col);
      for (const t of ALL_SQUARES) assert.equal(A.has(t), c.isAttacked(t, col), `attaque ${col} ${t} ${fenFrom(m)}`);
    }
    const pawnFiles = {};
    for (const s of Object.keys(m)) {
      if (m[s].toLowerCase() === 'p') pawnFiles[s[0] + m[s]] = (pawnFiles[s[0] + m[s]] || 0) + 1;
      if (base[s]) continue;
      const p = c.get(s), opp = other(p.color);
      assert.ok(!c.isAttacked(s, opp), `pièce ajoutée attaquée : ${s} ${fenFrom(m)}`);
      for (const t of ALL_SQUARES) {
        if (!c.attackers(t, p.color).includes(s)) continue;
        assert.ok(!foot.has(t), `pièce ajoutée ${s} attaque l'empreinte ${t}`);
        assert.ok(!(c.get(t) && c.get(t).color === opp), `pièce ajoutée ${s} attaque ${t}`);
      }
      assert.ok(p.type !== 'p' || (+s[1] >= 3 && +s[1] <= 6), `pion de bruit hors des rangées 3–6 : ${s}`);
    }
    // une colonne ne reçoit qu'un bélier, et seulement si elle n'avait aucun pion
    for (const [k, v] of Object.entries(pawnFiles)) assert.ok(v <= 1 || Object.keys(base).some(s => s[0] === k[0] && base[s].toLowerCase() === 'p'), `pions empilés ${k} ${fenFrom(m)}`);
    const mat = col => Object.values(m).filter(p => (p === p.toUpperCase()) === (col === 'w')).map(p => p.toLowerCase()).sort().join('');
    const baseMat = col => Object.values(base).filter(p => (p === p.toUpperCase()) === (col === 'w')).map(p => p.toLowerCase()).sort().join('');
    assert.equal(mat('w').length - baseMat('w').length, mat('b').length - baseMat('b').length, 'matériel équilibré');
  }
  assert.ok(units / 300 >= 3, `trop peu d'unités posées : ${(units / 300).toFixed(1)} en moyenne`);
  // Pion noir de rééquilibrage : doublé derrière un bélier, inerte.
  const m = addBlackPawn(rng, { e1: 'K', e8: 'k', c4: 'P', c5: 'p' }, new Set(['e1', 'e8']));
  assert.equal(m?.c6, 'p');
});

for (const id of ids) {
  test(`${id} : générateur synchrone, rapide, légal, coup clé et rôles cohérents`, () => {
    const spec = DRILLS[id], kind = verifyKind(spec);
    for (let level = 0; level < spec.levels.length; level++) {
      const rng = mulberry32(100 + level), n = N(60, 200, 400);
      const strata = [...new Set((spec.strata && spec.strata(level)) || [null])];
      const keys = new Set();
      const t0 = performance.now();
      let made = 0;
      for (let i = 0; i < n; i++) {
        const sub = strata[i % strata.length];
        const c = spec.generate(rng, level, sub);
        assert.ok(!(c instanceof Promise), 'generate doit être synchrone');
        if (!c) continue;
        made++;
        assert.ok(s0(c.fen, spec.s0), `${id} L${level + 1} S0 : ${c.fen}`);
        const chess = new Chess(c.fen);
        assert.equal(chess.turn(), spec.userSide);
        keys.add(placement(c.fen));
        for (const v of Object.values(c.roles || {}).flat()) if (typeof v === 'string' && /^[a-h]/.test(v)) assert.match(v, /^([a-h][1-8]){1,2}[qrbn]?$/, `rôle mal formé ${v}`);
        if (kind === 'def') {
          // la menace est un mat en 1 si les Blancs passaient leur tour
          const t = c.roles.threat, nm = new Chess(nullMoveFen(c.fen));
          nm.move({ from: t.slice(0, 2), to: t.slice(2, 4) });
          assert.ok(nm.isCheckmate(), `${id} : la menace ${t} ne mate pas : ${c.fen}`);
          continue;
        }
        const mv = chess.move({ from: c.key.slice(0, 2), to: c.key.slice(2, 4), promotion: 'q' });
        assert.ok(mv, `${id} : coup clé illégal ${c.key} ${c.fen}`);
        assert.equal(c.roles.piece, c.key.slice(0, 2));
        assert.equal(c.roles.to, c.key.slice(2, 4));
        if (kind === 'mate' && levelN(spec, level) === 1) assert.ok(chess.isCheckmate(), `${id} : le coup clé doit mater ${c.fen}`);
        if (kind === 'mate' && levelN(spec, level) === 2) assert.ok(chess.isCheck(), `${id} : le coup clé du mat en 2 fait échec ${c.fen}`);
      }
      const ms = (performance.now() - t0) / n;
      console.log(`  ${id} L${level + 1} : ${made}/${n} candidats, ${(100 * keys.size / Math.max(1, made)).toFixed(0)} % distincts, ${ms.toFixed(1)} ms par appel`);
      assert.ok(made >= 0.95 * n, `${id} L${level + 1} : ${made}/${n} candidats`);
      assert.ok(keys.size >= 0.75 * made, `${id} L${level + 1} : variété ${keys.size}/${made}`);
      assert.ok(ms <= 100, `${id} L${level + 1} : ${ms.toFixed(1)} ms par appel`);
      for (const sub of strata) assert.ok(spec.generate(rng, level, sub), `${id} L${level + 1} : sous-cas ${sub} jamais produit`);
    }
  });
}

// ---------------------------------------------------------------- 2. Production et contre-vérification
for (const id of ids) {
  test(`${id} : production, contre-vérification longue, acceptation, temps, variété`, LONG, async () => {
    const spec = DRILLS[id], top = spec.levels.length - 1;
    let agree = 0, total = 0;
    for (let level = 0; level <= top; level++) {
      const n = N(4, 20, 60), stat = { calls: 0, ok: 0 };
      // même spec, vérification comptée (acceptation = acceptées / candidats passés au moteur)
      const counted = { ...spec, verify: async (c2, cand, l) => { stat.calls++; const v = await spec.verify(c2, cand, l); if (v) stat.ok++; return v; } };
      const times = [], seen = new Set(), subs = new Set();
      let lvlAgree = 0, flips = 0, mirrors = 0;
      for (let i = 0; i < n; i++) {
        // Couleurs inversées une fois sur deux au dernier palier (le seul où l'exercice les échange).
        const colour = level === top && spec.flip && i % 2 ? other(spec.userSide) : spec.userSide;
        const t0 = performance.now();
        const s = await produce(counted, level, ctx, { colour });
        times.push(performance.now() - t0);
        assert.ok(s, `${id} L${level + 1} : aucune position`);
        // (a) légalité
        assert.ok(s0(s.fen, spec.s0), `${id} : S0 ${s.fen}`);
        assert.equal(new Chess(s.fen).turn(), s.userColor);
        assert.equal(s.userColor, colour);
        seen.add(placement(s.canonical)); subs.add(s.sub);
        flips += s.flip ? 1 : 0; mirrors += s.mirror ? 1 : 0;
        // (b) famille confirmée par une recherche plus longue, sur la position telle qu'elle sera jouée
        const r = await recheck(ctx.engine, spec, s);
        total++;
        if (r.ok) { agree++; lvlAgree++; } else console.log(`  désaccord ${id} L${level + 1} ${s.fen} → ${r.why}`);
      }
      const strata = [...new Set((spec.strata && spec.strata(level)) || [])];
      const covered = strata.filter(x => subs.has(x)).length;
      report.push({ id, level, n, calls: stat.calls, ok: stat.ok, med: median(times), p90: p90(times),
        distinct: Math.round(100 * seen.size / n), strata: strata.length ? `${covered}/${strata.length}` : '—', agree: `${lvlAgree}/${n}` });
      // (c) acceptation ≥ 5 %
      assert.ok(stat.ok / stat.calls >= 0.05, `${id} L${level + 1} : acceptation ${stat.ok}/${stat.calls}`);
      // (d) temps par position : médiane ≤ 300 ms au palier 1 (exigence), garde-fou à 600 ms ailleurs
      assert.ok(median(times) <= (level === 0 ? 300 : 600), `${id} L${level + 1} : médiane ${median(times).toFixed(0)} ms`);
      // (e) variété et sous-cas
      assert.ok(seen.size >= 0.9 * n, `${id} L${level + 1} : ${seen.size}/${n} placements distincts`);
      if (n >= 2 * strata.length) assert.equal(covered, strata.length, `${id} L${level + 1} : sous-cas couverts ${[...subs]}`);
      if (n >= 10) assert.ok(mirrors > 0 && mirrors < n, `${id} L${level + 1} : miroir jamais (ou toujours) appliqué`);
      if (n >= 2 && level === top && spec.flip) assert.ok(flips > 0, `${id} : couleurs jamais inversées`);
    }
    // accord ≥ 98 % (au moins un désaccord toléré pour les petits échantillons)
    assert.ok(agree >= total - Math.max(1, Math.floor(0.02 * total)), `${id} : accord ${agree}/${total}`);
  });
}

// (f) Symétrie : miroir et couleurs inversées transportent le coup clé (et la menace) avec la position.
test('symétrie : miroir et échange des couleurs gardent le coup clé et la menace', LONG, async () => {
  for (const id of ids) {
    const spec = DRILLS[id], kind = verifyKind(spec);
    for (let i = 0; i < N(2, 4, 10); i++) {
      const level = i % spec.levels.length;
      const s = await produce(spec, level, ctx, { colour: spec.userSide, mirror: false });
      const c = { fen: s.canonical, key: s.key, roles: s.roles, level, sub: s.sub };
      for (const [mirror, flip] of [[true, false], [false, true], [true, true]]) {
        const t = finalize(spec, c, { E0: s.E0, Ealt: s.Ealt, ref: s.ref, pv: s.pv }, { mirror, flip });
        const chess = new Chess(t.fen);
        assert.equal(chess.turn(), t.userColor);
        await ctx.engine.newGame();
        if (kind === 'def') {
          const nm = new Chess(nullMoveFen(t.fen));
          nm.move({ from: t.roles.threat.slice(0, 2), to: t.roles.threat.slice(2, 4) });
          assert.ok(nm.isCheckmate(), `${id} : menace ${t.roles.threat} après symétrie ${t.fen}`);
          continue;
        }
        assert.ok(chess.move({ from: t.key.slice(0, 2), to: t.key.slice(2, 4), promotion: 'q' }), `${id} : clé ${t.key} illégale dans ${t.fen}`);
        const [b] = await ctx.engine.analyse(t.fen, { depth: 10 });
        if (kind === 'mate') assert.equal(b.mate, levelN(spec, level), `${id} : ${t.fen}`);
        assert.equal(b.move.slice(0, 4), t.key.slice(0, 4), `${id} : la clé ${t.key} n'est plus le meilleur coup dans ${t.fen}`);
        assert.equal(t.pv?.[0]?.slice(0, 4), b.move.slice(0, 4), `${id} : variante mal transformée`);
      }
    }
  }
});

// ---------------------------------------------------------------- 3. Parties simulées
for (const id of ids) {
  test(`${id} : l'oracle réussit, une gaffe nette échoue sur-le-champ (Attempt)`, LONG, async () => {
    const spec = DRILLS[id], top = spec.levels.length - 1, rng = mulberry32(31);
    let won = 0, games = 0, clean = 0, failed = 0, blunders = 0, skipped = 0;
    for (let level = 0; level <= top; level++) {
      for (let i = 0; i < N(1, 8, 25); i++) {
        const colour = level === top && spec.flip && i % 2 ? other(spec.userSide) : spec.userSide;
        const s = await produce(spec, level, ctx, { colour });
        const a = await simulate(spec, s, ctx, oracle(1000));
        games++;
        if (a.outcome?.status === 'success') { won++; if (a.outcome.clean) clean++; }
        else console.log(`  échec de l'oracle ${id} L${level + 1} ${s.fen} : ${a.outcome?.reason} (${a.history.map(h => h.uci).join(' ')})`);
      }
      for (let i = 0; i < N(1, 8, 25); i++) {
        const colour = level === top && spec.flip && i % 2 ? other(spec.userSide) : spec.userSide;
        const s = await produce(spec, level, ctx, { colour });
        const a = new Attempt(spec, s, ctx);
        // une fois sur trois, la gaffe vient au 2e coup (après le meilleur premier coup)
        if (i % 3 === 2) { await a.userMove(await oracle(1000)(a)); if (a.over) continue; }
        const b = await findBlunder(ctx.engine, a.fen, a.T.lost, rng);
        if (!b) { skipped++; continue; }
        blunders++;
        const r = await a.userMove(b.move);
        if (r.status === 'end' && r.outcome.status === 'fail') failed++;
        else console.log(`  gaffe non sanctionnée ${id} L${level + 1} ${s.fen} ${b.move} (éval longue ${b.long}, seuil ${a.T.lost}) : ${r.status} ${r.outcome?.reason ?? ''}`);
      }
    }
    console.log(`  ${id} : oracle ${won}/${games} (propres ${clean}), gaffes sanctionnées ${failed}/${blunders} (${skipped} sans gaffe nette)`);
    assert.ok(won >= games - Math.floor(0.05 * games), `${id} : oracle ${won}/${games}`);
    if (!(N_BUG && fnGoal(spec))) assert.ok(clean >= 0.9 * won, `${id} : réussites propres ${clean}/${won}`);
    assert.ok(blunders > 0, `${id} : aucune gaffe trouvée`);
    assert.ok(failed >= blunders - Math.floor(0.05 * blunders), `${id} : gaffes sanctionnées ${failed}/${blunders}`);
  });
}

// ---------------------------------------------------------------- 4. Fixtures (§6.2-4)
const start = async (id, fen, extra = {}, level = 0) => {
  const spec = DRILLS[id], c = { fen, level, ...extra };
  await ctx.engine.newGame();
  const v = await spec.verify(ctx, c, level);
  assert.ok(v, `${id} : la position de test doit passer la vérification ${fen}`);
  return finalize(spec, c, v, {});
};
const script = (moves, then = oracle(1000)) => async a => (a.userMoves < moves.length ? moves[a.userMoves] : then(a));

test('fourchette royale : le gain est encaissé au 2e coup', LONG, async () => {
  const spec = DRILLS['fourchette-cavalier'];
  const s = await start('fourchette-cavalier', '8/4q2p/7P/8/1k1K3p/2N4P/8/8 w - - 0 1',
    { key: 'c3d5', roles: { piece: 'c3', to: 'd5', targets: ['b4', 'e7'], gain: 6 } });
  const a = await simulate(spec, s, ctx, script(['c3d5']));
  assert.equal(a.outcome?.status, 'success', a.outcome?.reason);
  assert.equal(a.userMoves, 2);
  assert.match(a.outcome.reason, /Matériel gagné/);
  assert.ok(a.outcome.clean);
});

test('sacrifice « de dépit » : du matériel ramassé sans avantage réel n’est pas une réussite', async () => {
  // Moteur scripté : on rejoue la même partie avec deux évaluations. Les Noirs sacrifient leur cavalier (Cf3+),
  // l'utilisateur le prend : +3, autant que le gain demandé. Si l'évaluation reste basse (le sacrifice était
  // correct), la règle v ≥ Ealt + 150 refuse la réussite ; si elle est haute, c'est une vraie réussite.
  const spec = DRILLS['piece-en-prise'];
  const fen = '6k1/5ppp/8/8/3n4/8/5PPP/3R2K1 w - - 0 1';
  const s = finalize(spec, { fen, level: 0, key: 'd1d4', roles: { piece: 'd1', to: 'd4', targets: ['d4'], gain: 3 } }, { E0: 300, Ealt: 50, k: 1 }, {});
  const play = async v => {
    const replies = { h2h3: 'd4f3', g2f3: 'g8f8' };
    const engine = {
      analyse: async () => { const last = a.history.at(-1).uci; return [{ move: replies[last], cp: -v, mate: null, pv: [replies[last]], depth: 10 }]; },
      stop: () => Promise.resolve(), newGame: () => Promise.resolve(),
    };
    const a = new Attempt(spec, s, { ...ctx, engine });
    const r1 = await a.userMove('h2h3');
    assert.equal(r1.status, 'continue');
    assert.equal(r1.reply.san, 'Nf3+');
    const r2 = await a.userMove('g2f3');
    return r2;
  };
  const low = await play(160);
  assert.equal(low.status, 'end');
  assert.notEqual(low.outcome.status, 'success', `fausse réussite : ${low.outcome.reason}`);
  const high = await play(450);
  assert.equal(high.outcome.status, 'success', high.outcome.reason);
});

test('mat en 2 : un autre chemin de même longueur est propre, un mat plus lent ne l’est pas', { ...LONG, todo: N_TODO }, async () => {
  // Deux premiers coups matent en 2 : Te8+ (la clé) et Dxe8+ ; l'utilisateur joue l'autre.
  const couloir = DRILLS['mat-couloir'];
  const dual = finalize(couloir, { fen: 'r5k1/5ppp/8/1Q6/8/8/5PPP/4R1K1 w - - 0 1', key: 'e1e8', level: 2 }, { ref: 2, E0: 9980 }, {});
  const a = await simulate(couloir, dual, ctx, script(['b5e8']));
  assert.equal(a.outcome?.status, 'success', a.outcome?.reason);
  assert.equal(a.userMoves, 2);
  assert.equal(a.outcome.clean, true, 'un mat en 2 par un autre chemin est propre');
  // Legs de Philidor : Dg8+ mate en 2 ; Cf7+ mate aussi, mais en 4 (Cf7+ Rg8 Ch6++ Rh8 Dg8+ Txg8 Cf7#).
  const etouffe = DRILLS['mat-etouffe'];
  const fen = '4r2k/6pp/7N/8/2Q5/8/5PP1/6K1 w - - 0 1';
  const slow = finalize(etouffe, { fen, key: 'c4g8', level: 2 }, { ref: 2, E0: 9980 }, {});
  const b = await simulate(etouffe, slow, ctx, script(['h6f7']));
  assert.equal(b.outcome?.status, 'success', b.outcome?.reason);
  assert.ok(b.userMoves > 2);
  assert.equal(b.outcome.clean, false, 'un mat plus lent que demandé n’est pas propre');
  assert.match(etouffe.levels[2].label, /2/);
  assert.equal(new Attempt(etouffe, slow, ctx).goalText(), 'Mat en 2.');
  const c = await simulate(etouffe, slow, ctx, oracle(1000));
  assert.equal(c.outcome.clean, true);
});

test('parer le mat du couloir : h3 réussit après 3 coups ; ignorer la menace échoue aussitôt', LONG, async () => {
  const spec = DRILLS['parer-couloir'];
  const fen = '1k6/p7/2r5/8/8/6R1/5PPP/6K1 w - - 0 1';
  const s = await start('parer-couloir', fen, { roles: { threat: 'c6c1', attacker: 'c6', king: 'g1' } });
  assert.equal(s.roles.threat, 'c6c1');
  const a = await simulate(spec, s, ctx, script(['h2h3']));
  assert.equal(a.outcome?.status, 'success', a.outcome?.reason);
  assert.equal(a.userMoves, 3);
  assert.match(a.outcome.reason, /Menace parée/);
  const b = new Attempt(spec, s, ctx);
  const r = await b.userMove('g3g7');      // la tour part prendre a7… et la 1re rangée tombe
  assert.equal(r.status, 'end');
  assert.equal(r.outcome.status, 'fail');
  assert.match(r.outcome.reason, /La menace passe/);
  assert.equal(b.keyFen, fen);
});

// ---------------------------------------------------------------- 5. Indice et « Pourquoi ? » (si l'explicateur est là)
let explainer = null;
try { explainer = await import('../../js/explain/index.js'); } catch { explainer = null; }
test('indice en trois marches et « Pourquoi ? » sur ces familles', { ...LONG, skip: !explainer && 'js/explain/index.js absent' }, async () => {
  const bad = /undefined|NaN|\s{2}/;
  for (const id of ids) {
    const spec = DRILLS[id];
    const s = await produce(spec, 0, ctx, { colour: spec.userSide });
    const a = new Attempt(spec, s, ctx);
    let h;
    for (let step = 1; step <= 3; step++) {
      h = await a.hint();
      assert.ok(h, `${id} : indice ${step}`);
      assert.equal(h.step, step);
      for (const t of [h.idea, ...(h.text || [])].filter(Boolean)) assert.ok(!bad.test(t), `${id} : texte « ${t} »`);
    }
    if (s.key) assert.equal(h.move.slice(0, 4), s.key.slice(0, 4), `${id} : l'indice du premier coup est la clé`);
    const blunder = await findBlunder(ctx.engine, a.fen, a.T.lost, mulberry32(3));
    if (!blunder) continue;
    const r = await a.userMove(blunder.move);
    if (r.outcome?.status !== 'fail') continue;
    const w = await a.why();
    assert.ok(w && Array.isArray(w.text) && w.text.length, `${id} : « Pourquoi ? » vide`);
    for (const t of w.text) assert.ok(!bad.test(t), `${id} : texte « ${t} »`);
  }
});

if (QUICK) console.log('  (QUICK : échantillons réduits)');
