// Explicateur à base de règles (spec §1.7 et §5) : une ou deux phrases vraies sur un coup, en français.
//
// API (synchrone, ne lève jamais d'exception ; en cas de souci, phrase générique honnête) :
//   explainMove({ fen, move, family, ideas = [], pv = [], lastMove = null, tb = null, level = 3, tip = null })
//     → { idea, text: string[], tags: string[], viz: { zone?, zoneCls?, marks?, arrows? }, debug }
//     level 1 (idée) et 2 (pièce) : `idea` et `text` ne révèlent ni le coup ni sa case d'arrivée ; viz sans flèche.
//     level 3 (coup) : 1 ou 2 phrases (≤ 180 caractères visibles), visuels après le coup.
//   explainMistake({ fen, userMove, bestMove, family, evalBest, evalUser, pvBest, pvUser, tb })
//     → { severity, text: string[], tags: string[], viz }
//     severity : 'same' | 'close' (aucun reproche) | 'slow' | 'weaker' | 'worse' | 'win-draw' | 'win-loss' | 'draw-loss' | 'unknown'
//   pickTeachingMove({ fen, family, ideas, candidates, tb = null, lastMove = null }) → uci
//     Parmi des coups également bons (égalités des tables, lignes MultiPV à 15 cp ou même mat), celui dont
//     l'explication est la plus forte. Le choix des candidats appartient à l'appelant (Attempt.candidates()).
//
// GREFFONS — une famille = un fichier dans js/explain/families/ + une ligne d'import ci-dessous :
//
//   // js/explain/families/kbnk.js
//   import { family, rule, X, boxViz } from '../rules.js';
//   rule({ id: 'kbnk-corner', run(c) {           // c = makeCtx : bn/an (nœuds avant/après), m, san, us, def, pv, tb…
//     if (!X.mating(c) || …) return null;          // un fait ne se déclenche que si tout est vérifié
//     return { idea: 'Pousse le roi vers le coin de la couleur de ton fou.',   // niveau 1, sans le coup
//              say: [`… ${a} … ${b} …`], tags: ['kbnk-corner'], viz: boxViz(c), viz1: boxViz(c, false) };
//   } });
//   export default family({
//     id: 'kbnk',                                  // ou une liste d'ids
//     rules: ['mate', 'rescue', 'kbnk-corner', 'box-shrink', 'approach', 'lookahead'],   // par priorité
//     warnings: ['stalemate-danger'],              // deuxième phrase prioritaire
//     mistakes: ['stalemate', 'piece-lost', 'box-grow', 'king-away'],                     // raisons d'explainMistake
//     fallback: { idea: '…', say: 'L’essentiel : …' },
//   });
//
// Les faits partagés sont dans rules.js (mat, sauvetage, boîte, motifs tactiques…), les raisons d'erreur dans
// mistakes.js. Les idées de l'exercice (spec.ideas) passent devant le reste de la famille, après les faits « fixed ».
import {
  FAMILIES, RULES, REASONS, rule, reason, family, familyOf, makeCtx, evaluate, sentences, mergeViz, stats, safeRun, MAX,
} from './rules.js';
import { severityOf, genericSentence, slowSentence } from './mistakes.js';
import { finish, visible, mv } from './fr.js';
import { name } from './features.js';

import './families/generic.js';
import './families/kqk.js';
import './families/krk.js';
import './families/krrk.js';
import './families/tactic-hanging.js';
import './families/tactic-fork.js';
import './families/tactic-skewer.js';
import './families/tactic-pin.js';
import './families/mate-pic.js';
import './families/parry.js';

export { FAMILIES, RULES, REASONS, rule, reason, family, stats };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const uniq = xs => [...new Set(xs.filter(Boolean))];
const HONEST_IDEA = 'Passe en revue les coups forcés : échecs, prises, menaces.';
const HONEST_SAY = 'C’est l’un des meilleurs coups ici, sans idée simple à nommer.';

// Combien de coups sont exactement aussi bons que celui-ci (tables) ? null si inconnu.
function tbTies(c) {
  try {
    if (!c.tb || !c.tb.probe(c.fen)) return null;
    const r = c.tb.rankMoves(c.fen), me = r.find(x => x.uci.slice(0, 4) === c.move.slice(0, 4));
    return me ? r.filter(x => x.win === me.win && x.dist === me.dist).length : null;
  } catch { return null; }
}
// Avertissement visible avant de jouer : si nous passions, le roi adverse n'aurait que 1 ou 2 coups.
function stalemateNow(c, fam) {
  if (!(fam.warnings || []).includes('stalemate-danger')) return false;
  const nl = c.bn.nul;
  return !!nl && !nl.check && nl.legal.length > 0 && nl.legal.length <= 2 && nl.kingOnly;
}
function fallbackTexts(c, fam, tip) {
  const fb = fam.fallback;
  if (fb && fb.say) {
    const ties = tbTies(c);
    return [ties > 1 ? 'Plusieurs coups se valent ici.' : null, fb.say].filter(Boolean);
  }
  if (tip) return [tip];
  return [HONEST_SAY];
}

function explainMoveRaw({ fen, move, family: famId, ideas = [], pv = [], lastMove = null, tb = null, level = 3, tip = null }) {
  const fam = familyOf(famId);
  const c = makeCtx({ fen, move, family: famId, ideas, pv, lastMove, tb, level });
  if (!c) return honest(level);
  const { primary, warning } = evaluate(c, fam);
  const tags = uniq([primary ? primary.id : 'fallback', ...(primary?.tags || []), warning?.id]);
  const idea0 = primary ? primary.idea : fam.fallback?.idea || HONEST_IDEA;
  const idea = finish(stalemateNow(c, fam) && primary?.id !== 'mate' && !/pat/.test(idea0) ? `${idea0} Attention au pat !` : idea0);
  const debug = { primary: primary?.id ?? null, warning: warning?.id ?? null, data: primary?.data ?? null, family: fam.id };
  if (level < 3) {
    const viz = mergeViz(primary?.viz1);
    delete viz.arrows;
    if (viz.marks) delete viz.marks[name(c.m.to)];
    if (level === 2) viz.marks = { ...(viz.marks || {}), [name(c.m.from)]: 'mark-hint' };
    return { idea, text: [idea], tags, viz, debug };
  }
  let text;
  if (primary) text = sentences(primary, warning);
  else {
    const fb = fallbackTexts(c, fam, tip);
    text = [fb.join(' ')];
    if (warning && visible(text[0] + ' ' + warning.say[0]) <= MAX) text.push(warning.say[0]);
    text = text.map(finish);
  }
  return { idea, text, tags, viz: mergeViz(primary?.viz, warning?.viz), debug };
}
function honest(level) {
  const idea = finish(HONEST_IDEA);
  return { idea, text: [level < 3 ? idea : finish(HONEST_SAY)], tags: ['fallback'], viz: {}, debug: { primary: null } };
}

export function explainMove(args = {}) {
  const t0 = now();
  const r = safeRun(explainMoveRaw, args || {}) || honest((args && args.level) || 3);
  r.debug = { ...(r.debug || {}), ms: now() - t0 };
  return r;
}

// Phrase « Mieux : **B**. … » : le coup, puis la première phrase de son explication si elle tient.
function betterLine(b, fam, ideas) {
  const head = `Mieux : ${mv(b.san)}.`;
  const { primary } = evaluate(b, fam);
  if (!primary) return finish(head);
  if (primary.id === 'mate') return finish(`Mieux : ${mv(b.san)}, qui mate.`);
  const s = finish(primary.say[0]);
  return visible(head + ' ' + s) <= MAX ? `${finish(head)} ${s}` : finish(head);
}

function explainMistakeRaw({ fen, userMove, bestMove = null, family: famId, evalBest = null, evalUser = null, pvBest = [], pvUser = [], tb = null }) {
  const fam = familyOf(famId);
  const u = makeCtx({ fen, move: userMove, family: famId, pv: pvUser, tb });
  if (!u) return { severity: 'unknown', text: [finish('Le moteur préfère un autre coup.')], tags: ['unknown', 'generic'], viz: {} };
  const b = bestMove ? makeCtx({ fen, move: bestMove, family: famId, pv: pvBest, tb }) : null;
  const sev = severityOf({ fen, userMove, bestMove, tb, evalBest, evalUser });
  if (sev.id === 'same') return { severity: 'same', text: [finish('Ton coup est aussi bon.')], tags: ['same'], viz: {} };
  if (sev.id === 'close') return { severity: 'close', text: [finish(b ? `Ton coup est presque aussi bon : le moteur préfère de peu ${mv(b.san)}.` : 'Ton coup est presque aussi bon.')], tags: ['close'], viz: {} };
  const memo = new Map();
  const env = { primary: x => { if (!memo.has(x)) memo.set(x, evaluate(x, fam).primary); return memo.get(x); } };
  let why = null;
  for (const id of fam.mistakes || []) {
    const R = REASONS[id];
    if (!R) continue;
    const f = safeRun((x, y) => R.run(x, y, sev, env), u, b);
    if (f) { why = { id, ...f }; break; }
  }
  let first;
  if (sev.id === 'slow') {
    const s = slowSentence(sev);
    first = why && visible(s + ' ' + why.say) <= MAX ? `${s} ${why.say}` : s;
  } else first = why ? why.say : genericSentence(sev, evalBest, evalUser);
  const text = [finish(first)];
  if (b && !(why && why.noBetter)) text.push(betterLine(b, fam));
  return {
    severity: sev.id, text, tags: uniq([sev.id, why ? why.id : 'generic', ...(why?.tags || [])]),
    viz: mergeViz(why?.viz),
  };
}

export function explainMistake(args = {}) {
  const t0 = now();
  const r = safeRun(explainMistakeRaw, args || {})
    || { severity: 'unknown', text: [finish('Le moteur préfère un autre coup.')], tags: ['unknown', 'generic'], viz: {} };
  r.debug = { ms: now() - t0 };
  return r;
}

export function pickTeachingMove({ fen, family: famId, ideas = [], candidates = [], tb = null, lastMove = null } = {}) {
  const list = (candidates || []).filter(Boolean);
  if (list.length <= 1) return list[0] ?? null;
  try {
    const fam = familyOf(famId);
    let best = list[0], score = -Infinity;
    for (const mvU of list) {
      const c = makeCtx({ fen, move: mvU, family: famId, ideas, tb, lastMove });
      if (!c) continue;
      const { primary, prio } = evaluate(c, fam);
      const s = primary ? prio : 0;
      if (s > score) { score = s; best = mvU; }
    }
    return best;
  } catch { return list[0]; }
}
