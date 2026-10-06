// Progression v2 « Exercices en boucle » : logique pure (spec §1.8 et §4).
// Le magasin `s` (celui de util.load()) et le registre des exercices sont toujours passés en paramètre :
// aucun import du catalogue, aucun accès au DOM ni au stockage, donc testable tel quel dans Node.
//
// Registre : reg = { byId: {id: spec}, list: [spec], parcours: [id…], coveredBy: {id: [ids qui l'englobent]} }
// Fiche d'un exercice (s.drills[id]) : voir fresh().
// Toutes les fonctions qui dépendent de l'heure prennent `now` (ms) ; le hasard (±10 % sur les intervalles)
// passe par `opts.rng` (Math.random par défaut) pour que les tests soient déterministes.

export const DRILL_INTERVALS = [1, 3, 7, 14, 30, 60, 120];   // jours (spec §4.4)
export const DAY = 864e5, H12 = 12 * 36e5;
const I = DRILL_INTERVALS;
const KNOWN = ['acq', 'mast', 'rusty'];
const LOG_MAX = 300, HIST_MAX = 20, ERR_MAX = 10, MAX_CHECKS = 3;

// ---------- Fiche et utilitaires ----------
export const fresh = () => ({
  n: 0, ok: 0, clean: 0,
  level: 0, up: 0, fast: true,               // escalier : palier courant, propres d'affilée à ce palier, voie rapide
  streak: 0, var: 0, need: null,             // série propre ; couleurs de la série (1 = Blancs, 2 = Noirs) ; need imposé après un raté
  hist: '',                                  // 20 derniers codes, le plus récent à la fin
  st: 'new',                                 // new | learn | acq | mast | rusty
  acqAt: 0, mastAt: 0,
  box: 0, due: 0, chk: '', lastChk: 0, lapses: 0,
  err: [],                                   // ≤ 10 positions difficiles {fen, level, sub} (forme canonique)
  placed: false, best: null, last: 0,
});
const FRESH = Object.freeze({ ...fresh(), err: Object.freeze([]) });
const topOf = spec => Math.max(0, (spec.levels?.length || 1) - 1);
const isKnown = st => KNOWN.includes(st);
const rec = (s, id) => s?.drills?.[id] || FRESH;
const isA = d => (d.phase ?? 'A') === 'A';
const plural = (n, w, ws = w + 's') => `${n} ${n > 1 ? ws : w}`;

// Jour local « AAAA-MM-JJ » : la « journée » de l'utilisateur, pas celle de Greenwich.
export function dayStr(ts) {
  const d = new Date(ts), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const stateOf = (s, id) => rec(s, id).st || 'new';

// Exercices englobés par `spec` (covers), de proche en proche.
function coversOf(reg, spec) {
  const out = [], seen = new Set([spec.id]), todo = [...(spec.covers || [])];
  while (todo.length) {
    const x = todo.shift();
    if (seen.has(x)) continue;
    seen.add(x); out.push(x);
    todo.push(...(reg?.byId?.[x]?.covers || []));
  }
  return out;
}
// Un exercice englobé par un exercice déjà acquis n'est jamais programmé (spec §4.4).
export const coveredByKnown = (s, reg, id) => (reg?.coveredBy?.[id] || []).some(y => isKnown(stateOf(s, y)));

// ---------- §4.1 Codes de résultat ----------
export const slackMate = r => Math.max(2, Math.ceil(r / 4));
export const slackPromo = r => Math.max(3, Math.ceil(r / 3));
// Règle « propre » du tableau §2.4, utilisée quand la tentative ne fournit pas `clean` elle-même.
export function isClean(goal = {}, a) {
  const m = a.moves ?? 0, ref = a.ref;
  if (goal.kind === 'mate') return goal.n ? m <= goal.n : !ref || m <= ref + slackMate(ref);
  if (goal.kind === 'promote') return !ref || m <= ref + slackPromo(ref);
  if (goal.kind === 'material') return a.k == null || m <= a.k + 1;
  return true;
}
// C propre · S réussi pas propre · H réussi avec indice · F échec · A abandon · R hors série · null = rien à noter.
export function outcome(spec, a) {
  if (!a) return null;
  if (a.retry) return 'R';
  if (a.abandoned) return a.moves ? 'A' : null;
  if (!a.reached) return 'F';
  if (a.hints) return 'H';
  return (typeof a.clean === 'boolean' ? a.clean : isClean(spec.goal, a)) ? 'C' : 'S';
}

// ---------- §4.2 Escalier et couleur ----------
function stepLevel(spec, r, o, played) {
  const top = topOf(spec);
  if (!(r.st === 'new' || r.st === 'learn')) return;                 // acquis : escalier gelé au dernier palier
  if (o === 'F' || o === 'A') r.fast = false;                        // fin de la voie rapide au premier échec
  if (played !== r.level) return;                                    // position rejouée d'un autre palier : neutre
  if (o === 'C') {
    if (r.level < top && ++r.up >= (r.fast ? 1 : 3)) { r.level++; r.up = 0; r.streak = 0; r.var = 0; }
  } else if (o === 'F' || o === 'A') { r.up = 0; r.level = Math.max(0, r.level - 1); }
  else r.up = 0;                                                     // S, H : seul le compteur repart à zéro
}

// Palier et couleur de la prochaine position. La couleur manquante est imposée dès qu'il ne manque plus
// qu'une partie à la série (≥ et non ===, pour ne jamais rester coincé si une partie a échappé à la règle).
export function setupFor(spec, r, rng = Math.random) {
  const top = topOf(spec);
  const level = r && isKnown(r.st) ? top : Math.min(r?.level ?? 0, top);
  let colour = spec.userSide || 'w';
  if (spec.flip && level === top) {
    const need = r?.need ?? spec.need ?? 3, v = r?.var ?? 0;
    if (r && v && v !== 3 && r.streak >= need - 1) colour = v & 1 ? 'b' : 'w';
    else colour = rng() < 0.5 ? 'w' : 'b';
  }
  return { level, colour };
}

// ---------- §4.3 États de maîtrise ----------
function pushLog(s, e) {
  (s.log ||= []).push(e);
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX);
}
const due = (r, now, jitter) => now + I[r.box] * DAY * jitter();

// Enregistre une tentative (résumé de Attempt.summary()) ; renvoie le code ou null.
export function record(s, spec, a, now = Date.now(), reg = null, { rng = Math.random } = {}) {
  const o = outcome(spec, a);
  if (!o) return null;
  const jitter = () => 0.9 + rng() * 0.2;
  s.drills ||= {};
  pushLog(s, [now, spec.id, o, a.level ?? 0, a.moves ?? null, a.ref ?? null, a.hints || 0, Math.round(a.secs || 0), a.color ?? spec.userSide ?? 'w']);
  if (o === 'R') return o;                                           // hors série : journal seulement
  const r = (s.drills[spec.id] ||= fresh()), top = topOf(spec);
  if (r.level > top) r.level = top;                                  // catalogue raccourci depuis
  const played = a.level ?? r.level;
  r.n++; r.last = now;
  if ('CSH'.includes(o)) r.ok++;
  r.hist = (r.hist + o).slice(-HIST_MAX);
  if (o === 'C') {
    r.clean++;
    // Une position propre d'un palier plus facile (erreur rejouée) ne compte pas pour la série, sans la casser.
    if (played >= r.level) { r.streak++; r.var |= (a.color ?? spec.userSide) === 'b' ? 2 : 1; }
    if (played === top && a.moves && (r.best == null || a.moves < r.best)) r.best = a.moves;
  } else { r.streak = 0; r.var = 0; }
  if ((o === 'F' || o === 'S') && a.keyFen) {
    r.err = [...(r.err || []).filter(e => e.fen !== a.keyFen), { fen: a.keyFen, level: played, sub: a.sub ?? null }].slice(-ERR_MAX);
  }
  if (o === 'C' && a.fromErr) {
    const f = typeof a.fromErr === 'string' ? a.fromErr : a.fromErr.fen;
    r.err = (r.err || []).filter(e => e.fen !== f);
  }
  stepLevel(spec, r, o, played);
  if (r.st === 'new') r.st = 'learn';
  if (r.st === 'learn' || r.st === 'rusty') promote(s, spec, r, now, reg, jitter);
  else check(r, o, now, jitter);
  if (o === 'C') for (const x of coversOf(reg, spec)) refresh(s.drills[x], now);
  return o;
}

function promote(s, spec, r, now, reg, jitter) {
  const need = r.need ?? spec.need ?? 3;
  if (r.level !== topOf(spec) || r.streak < need || (spec.flip && r.var !== 3)) return false;
  if (r.st === 'rusty') r.st = 'mast';                               // garde la boîte réduite
  else { r.st = 'acq'; r.acqAt = now; r.box = 0; r.up = 0; }
  r.need = null; r.chk = dayStr(now); r.lastChk = now; r.due = due(r, now, jitter);
  for (const x of coversOf(reg, spec)) place(s, reg, x, now, jitter);
  return true;
}

// Seule la première tentative de la journée sur un exercice acquis est un contrôle.
function check(r, o, now, jitter) {
  const today = dayStr(now);
  if (r.chk === today) return false;
  const elapsed = now - r.lastChk;
  r.chk = today; r.lastChk = now;
  if (o === 'C') {
    if (r.st === 'acq' && now - r.acqAt >= H12) { r.st = 'mast'; r.mastAt = now; }
    if (elapsed >= 0.5 * I[r.box] * DAY) r.box = Math.min(r.box + 1, I.length - 1);
  } else if (o !== 'S') {                                            // F, A, H : raté
    r.lapses++; r.box = Math.max(0, r.box - 2); r.streak = 0; r.var = 0; r.need = 2;
    r.st = r.st === 'acq' ? 'learn' : 'rusty';
  }
  r.due = due(r, now, jitter);
  return true;
}

// Révision implicite : une partie propre repousse le contrôle des exercices englobés.
function refresh(x, now) {
  if (x && (x.st === 'acq' || x.st === 'mast')) { x.lastChk = now; x.due = Math.max(x.due || 0, now + I[x.box] * DAY); }
}
// Placement : acquérir un exercice valide ceux qu'il englobe.
function place(s, reg, id, now, jitter) {
  const x = (s.drills[id] ||= fresh());
  if (x.st === 'acq' || x.st === 'mast') return refresh(x, now);
  if (x.st === 'rusty') Object.assign(x, { st: 'mast', need: null, streak: 0, var: 0 });
  else {
    const sp = reg?.byId?.[id];
    Object.assign(x, { st: 'acq', placed: true, acqAt: now, box: 0, need: null, up: 0, fast: false, level: sp ? topOf(sp) : x.level });
  }
  x.chk = dayStr(now); x.lastChk = now; x.due = due(x, now, jitter);
}

// Bloc « en cours » d'une séance : trois échecs de suite arrêtent le bloc et redescendent d'un palier de plus.
// `played` = nombre de parties déjà jouées dans ce bloc (la dernière comprise). Renvoie le texte, ou null.
export function focusBreak(s, spec, played = 3) {
  const r = s.drills?.[spec.id];
  if (!r || played < 3 || !r.hist.endsWith('FFF')) return null;
  if (r.brk !== r.n) {                                               // une seule descente par série d'échecs
    r.brk = r.n;
    if (r.st === 'learn') { r.level = Math.max(0, r.level - 1); r.up = 0; }
  }
  return 'On reprend plus tard : trois échecs de suite, c’est le signal de changer d’air.';
}

// ---------- §1.8 Migration du magasin v1 ----------
// Indices du dernier palier figés ici (mat-deux-tours 1 palier, mat-dame 3, mat-tour 4) : pas de registre requis.
export const MIGRATE_MAP = { krrk: ['mat-deux-tours', 0], kqk: ['mat-dame', 2], krk: ['mat-tour', 3] };
export function migrate(s, now = Date.now()) {
  if (!s || typeof s !== 'object') return s;
  s.drills ||= {}; s.log ||= []; s.prefs ||= {};
  if (!(s.v >= 2)) {
    for (const [old, [id, top]] of Object.entries(MIGRATE_MAP)) {
      const r = s.finales?.[old];
      if (!r?.tries || s.drills[id]) continue;                       // jamais écraser une fiche v2
      const d = s.drills[id] = { ...fresh(), n: r.tries, ok: r.wins || 0, clean: r.perfect || 0, last: now };
      // ≥ 3 parties « parfaites » : acquis, contrôle dû dès la première séance (une partie propre → Maîtrisé).
      if ((r.perfect || 0) >= 3) Object.assign(d, { st: 'acq', level: top, fast: false, acqAt: now - DAY, lastChk: now - DAY, due: now });
      else Object.assign(d, { st: 'learn', level: r.wins ? Math.max(0, top - 1) : 0, fast: true });
    }
    s.v = 2;
  }
  // Fiches incomplètes (ancienne sauvegarde, import partiel) : on complète sans rien écraser.
  for (const r of Object.values(s.drills)) if (r && typeof r === 'object') for (const [k, v] of Object.entries(FRESH)) if (!(k in r)) r[k] = Array.isArray(v) ? [] : v;
  return s;
}

// ---------- §4.5 Accès conseillé (souple) ----------
export const missingPrereqs = (s, reg, id) => (reg.byId[id]?.prereq || []).filter(x => reg.byId[x] && !isKnown(stateOf(s, x)));
export const prereqOk = (s, reg, id) => missingPrereqs(s, reg, id).length === 0;
// « Recommandé » : prérequis acquis, ou exercice déjà commencé.
export const isRecommended = (s, reg, id) => stateOf(s, id) !== 'new' || prereqOk(s, reg, id);
export function gateText(s, reg, id) {
  const m = missingPrereqs(s, reg, id);
  return m.length ? `Il te manque : ${m.map(x => reg.byId[x].title).join(', ')}. Essayer quand même ?` : '';
}
// « Tu es ici » : premier exercice du parcours en cours ou nouveau dont les prérequis sont acquis.
export function hereId(s, reg, exclude = null) {
  return reg.parcours.find(id => id !== exclude && ['new', 'learn'].includes(stateOf(s, id)) && prereqOk(s, reg, id)) || null;
}

// ---------- §4.6 Séance du jour ----------
const overdue = (r, now) => (now - r.lastChk) / (I[r.box] * DAY);
export const isDue = (r, now) => (r.st === 'acq' || r.st === 'mast') && r.chk !== dayStr(now) && now >= r.due;

// Jamais deux fois de suite le même parcours quand on peut l'éviter ; sinon l'ordre de priorité est gardé.
export function interleaveByTrack(xs, trackOf = x => x.d.track) {
  const rest = [...xs], out = [];
  while (rest.length) {
    const prev = out.length ? trackOf(out.at(-1)) : null, count = {};
    for (const x of rest) count[trackOf(x)] = (count[trackOf(x)] || 0) + 1;
    const ok = rest.filter(x => trackOf(x) !== prev);
    // un parcours majoritaire doit passer maintenant, sinon deux de ses exercices finiront côte à côte
    const pick = ok.find(x => count[trackOf(x)] * 2 > rest.length) ?? ok[0] ?? rest[0];
    out.push(rest.splice(rest.indexOf(pick), 1)[0]);
  }
  return out;
}

// Durée d'une partie : médiane des durées notées pour cet exercice, sinon 120 s (partie jouée) ou 45 s (un coup clé).
export function estimateSecs(s, reg, id) {
  const xs = (s.log || []).filter(e => e[1] === id && 'CSHF'.includes(e[2]) && e[7] > 0).slice(-15).map(e => e[7]).sort((a, b) => a - b);
  if (xs.length) return Math.min(600, Math.max(10, xs.length % 2 ? xs[xs.length >> 1] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2));
  const d = reg?.byId?.[id];
  return d && ((d.need ?? 3) >= 5 || d.goal?.kind === 'material' || (d.goal?.kind === 'mate' && d.goal.n)) ? 45 : 120;
}
const melangeUnit = (s, reg) => {
  const pool = melangePool(s, reg);
  return pool.length ? pool.reduce((t, d) => t + estimateSecs(s, reg, d.id), 0) / pool.length : 120;
};

// Ramène la séance au budget (secondes) : on raccourcit d'abord, puis on retire mélange, nouveauté,
// contrôles en trop, et en dernier recours la fin de la liste. Le premier élément reste toujours.
export function trimToBudget(items, budget, s, reg) {
  const xs = items.map(it => ({ ...it, unit: it.kind === 'melange' ? melangeUnit(s, reg) : estimateSecs(s, reg, it.id) }));
  const total = () => xs.reduce((t, it) => t + it.n * it.unit, 0);
  const shrink = (kind, min) => { for (const it of xs) while (it.kind === kind && it.n > min && total() > budget) it.n--; };
  const drop = test => { for (let i = xs.length - 1; i >= 0 && xs.length > 1 && total() > budget; i--) if (test(xs[i], i)) xs.splice(i, 1); };
  shrink('melange', 2); shrink('nouveau', 2); shrink('focus', 4); shrink('controle', 1); shrink('reprise', 2);
  drop(it => it.kind === 'melange');
  shrink('focus', 3);
  drop(it => it.kind === 'nouveau');
  drop((it, i) => it.kind === 'controle' && xs.findIndex(x => x.kind === 'controle' || x.kind === 'reprise') < i);
  while (xs.length > 1 && total() > budget) xs.pop();
  return xs.map(({ unit, ...it }) => ({ ...it, secs: Math.round(it.n * unit) }));
}

// Items : {kind:'reprise'|'controle'|'focus'|'nouveau'|'melange', id?, n, until?, secs}
export function planSeance(s, reg, now = Date.now(), budget = 15 * 60) {
  const R = id => rec(s, id), cov = id => coveredByKnown(s, reg, id), items = [];
  // 1. Révisions : à reprendre d'abord, puis contrôles dus par retard relatif ; 3 au plus.
  const rev = reg.list.filter(d => isA(d) && !cov(d.id)).map(d => ({ d, r: R(d.id) }))
    .filter(({ r }) => r.st === 'rusty' || isDue(r, now))
    .map(x => ({ ...x, p: x.r.st === 'rusty' ? 100 + overdue(x.r, now) : overdue(x.r, now) }))
    .sort((a, b) => b.p - a.p).slice(0, MAX_CHECKS);
  for (const { d, r } of interleaveByTrack(rev)) {
    items.push(r.st === 'rusty' ? { kind: 'reprise', id: d.id, n: 4, until: 'mast' } : { kind: 'controle', id: d.id, n: 2 });
  }
  // 2. L'exercice en cours le plus avancé dans le parcours, joué en bloc.
  const learning = reg.parcours.filter(id => R(id).st === 'learn' && !cov(id));
  if (learning[0]) items.push({ kind: 'focus', id: learning[0], n: 6, until: 'acq' });
  // 3. Une nouveauté, seulement si moins de deux exercices sont en cours.
  if (learning.length < 2) {
    const nx = reg.parcours.find(id => R(id).st === 'new' && prereqOk(s, reg, id) && !cov(id));
    if (nx) items.push({ kind: 'nouveau', id: nx, n: 3 });
  }
  // 4. Mélange : au moins 3 exercices connus, et au moins 2 à tirer.
  const known = reg.list.filter(d => isA(d) && isKnown(R(d.id).st)).length;
  if (known >= 3 && melangePool(s, reg).length >= 2) items.push({ kind: 'melange', n: Math.max(2, 5 - rev.length) });
  return trimToBudget(items, budget, s, reg);
}

// ---------- §4.7 Mélange ----------
export const melangePool = (s, reg) => reg.list.filter(d => isA(d) && ['acq', 'mast'].includes(stateOf(s, d.id)) && !coveredByKnown(s, reg, d.id));
export const melangeWeight = (r, now) => Math.min(3, Math.max(0.3, overdue(r, now) || 0));
// Tirage pondéré : jamais deux fois le même parcours d'affilée ; une fois sur deux, le « contraste » du précédent.
export function pickMelange(s, reg, prev = null, rng = Math.random, now = Date.now()) {
  const pool = melangePool(s, reg);
  if (!pool.length) return null;
  const p = prev && reg.byId[prev];
  if (p && rng() < 0.5) {
    const c = (p.contrast || []).filter(id => id !== prev && pool.some(d => d.id === id));
    if (c.length) return c[Math.floor(rng() * c.length)];
  }
  let cand = pool.filter(d => !p || d.track !== p.track);
  if (!cand.length) cand = pool.filter(d => d.id !== prev);
  if (!cand.length) cand = pool;
  const w = cand.map(d => melangeWeight(rec(s, d.id), now)), total = w.reduce((a, b) => a + b, 0);
  let x = rng() * total;
  for (let i = 0; i < cand.length; i++) { x -= w[i]; if (x < 0) return cand[i].id; }
  return cand.at(-1).id;
}

// ---------- Synthèses pour l'accueil et le parcours ----------
// Comptes par état ; `due` = contrôles dus (hors exercices englobés), `review` = à revoir (dus + à reprendre).
export function trackSummary(s, reg, now = Date.now()) {
  const blank = () => ({ total: 0, new: 0, learn: 0, acq: 0, mast: 0, rusty: 0, due: 0, review: 0, known: 0 });
  const all = blank(), tracks = {};
  for (const d of reg.list) {
    const r = rec(s, d.id), t = (tracks[d.track] ||= blank()), st = r.st || 'new';
    const dueNow = isDue(r, now) && !coveredByKnown(s, reg, d.id);
    for (const x of [all, t]) {
      x.total++; x[st]++;
      if (dueNow) x.due++;
      if (dueNow || st === 'rusty') x.review++;
      if (isKnown(st)) x.known++;
    }
  }
  return { ...all, tracks };
}

// « Prochain contrôle : jeudi (2 exercices). » ou '' quand rien n'est programmé.
export function nextDueText(s, reg, now = Date.now()) {
  const ts = reg.list.filter(d => isA(d) && ['acq', 'mast'].includes(stateOf(s, d.id)) && !coveredByKnown(s, reg, d.id))
    .map(d => Math.max(rec(s, d.id).due || now, now));
  if (!ts.length) return '';
  const first = Math.min(...ts), day = dayStr(first), n = ts.filter(t => dayStr(t) === day).length;
  return `Prochain contrôle : ${dueLabel(first, now)} (${plural(n, 'exercice')}).`;
}

// Que proposer après une tentative (spec §4.6).
export function nextStep(s, reg, id, { seance = false } = {}) {
  if (seance) return { kind: 'seance', id, label: 'Suite de la séance' };
  if (isKnown(stateOf(s, id))) {
    const nx = hereId(s, reg, id);
    if (nx) {
      const t = reg.byId[nx].title;
      return { kind: 'next', id: nx, title: t, label: `Passer à ${t}`, stay: 'Continuer ici', text: `Prochaine étape : ${t}` };
    }
  }
  return { kind: 'same', id, label: 'Position suivante' };
}

// ---------- Textes (§4.8) ----------
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
// « aujourd’hui », « demain », « jeudi », « dans 12 jours » (jours du calendrier local).
export function dueLabel(ts, now = Date.now()) {
  const a = new Date(now), b = new Date(ts);
  const n = Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
  if (n <= 0) return 'aujourd’hui';
  if (n === 1) return 'demain';
  if (n < 7) return WEEKDAYS[b.getDay()];
  return `dans ${n} jours`;
}
const nextCheck = (ts, now) => `Prochain contrôle ${dueLabel(ts, now)}.`;

const LABELS = { new: 'Nouveau', learn: 'En cours', acq: 'Acquis', mast: 'Maîtrisé', rusty: 'À reprendre' };
export const stateLabel = st => LABELS[st] || LABELS.new;
export function streakDots(r, need = r?.need ?? 3) {
  const k = Math.min(r?.streak || 0, need);
  return '●'.repeat(k) + '○'.repeat(Math.max(0, need - k));
}

// Première ligne du bilan. before/after = fiche avant/après record() (before null au premier essai).
// Avec store et reg, signale aussi les exercices validés par placement. md:true entoure les mots clés de **.
export function resultText({ spec, code, attempt: a = {}, before = null, after = null, now = Date.now(), store = null, reg = null, md = false }) {
  if (code === 'R') return 'Hors série : cette partie ne compte pas pour la progression.';
  const b = { ...FRESH, ...(before || {}) }, r = { ...FRESH, ...(after || {}) };
  const B = w => (md ? `**${w}**` : w), out = [];
  const g = spec.goal || {}, m = a.moves ?? 0, ref = a.ref, top = topOf(spec);
  // 1. Le compteur, pour les objectifs mesurés en coups.
  if (code === 'C' || code === 'S') {
    if (g.kind === 'mate' && g.n) out.push(code === 'C' ? `Mat en ${g.n} trouvé.` : `Mat en ${plural(m, 'coup')} au lieu de ${g.n}.`);
    else if (g.kind === 'mate' || g.kind === 'promote') {
      const what = g.kind === 'mate' ? 'Mat' : 'Promotion sûre';
      if (!ref) out.push(`${what} en ${plural(m, 'coup')}.`);
      else if (code === 'C') out.push(`${what} en ${plural(m, 'coup')} (référence ${ref}).`);
      else out.push(`${what} en ${plural(m, 'coup')} (référence ${ref}, limite ${ref + (g.kind === 'mate' ? slackMate(ref) : slackPromo(ref))}).`);
    }
  }
  // 2. Ce que la partie change.
  const checked = (b.st === 'acq' || b.st === 'mast') && b.chk !== r.chk;   // c'était le contrôle du jour
  if (code === 'C') {
    if (!isKnown(b.st) && r.st === 'acq') {
      out.push(`${B('Acquis')} : ${plural(r.streak, 'partie propre', 'parties propres')} d’affilée. On revérifie ${dueLabel(r.due, now)}.`);
      const placed = reg && store ? coversOf(reg, spec).filter(x => store.drills?.[x]?.placed && store.drills[x].acqAt === r.acqAt && reg.byId[x]) : [];
      if (placed.length) out.push(`Validé du même coup : ${placed.map(x => reg.byId[x].title).join(', ')}.`);
    } else if (b.st === 'acq' && r.st === 'mast') out.push(`${B('Maîtrisé')} : toujours propre après une nuit. ${nextCheck(r.due, now)}`);
    else if (b.st === 'rusty' && r.st === 'mast') out.push(`${B('Maîtrisé')} à nouveau. ${nextCheck(r.due, now)}`);
    else if (checked && r.st === 'acq') out.push(`${B('Propre')}. Le contrôle compte après une nuit : on revérifie ${dueLabel(r.due, now)}.`);
    else if (checked) out.push(`${B('Propre')} : contrôle réussi. ${nextCheck(r.due, now)}`);
    else if (r.st === 'acq' || r.st === 'mast') out.push(`${B('Propre')}.`);
    else if (r.level > b.level) out.push(`${B('Propre')}. Palier suivant : ${spec.levels?.[r.level]?.label || r.level + 1} (${r.level + 1}/${top + 1}).`);
    else if (r.level < top) out.push(`${B('Propre')}. Encore ${plural(3 - r.up, 'partie propre', 'parties propres')} pour passer au palier suivant.`);
    else {
      const need = r.need ?? spec.need ?? 3;
      let t = `${B('Propre')}. Série : ${Math.min(r.streak, need)} sur ${need}.`;
      if (spec.flip && r.var && r.var !== 3 && r.streak >= need - 1) t += ` La prochaine se joue avec les ${r.var & 1 ? 'Noirs' : 'Blancs'}.`;
      out.push(t);
    }
  } else if (code === 'S') out.push(checked && isKnown(r.st) ? `Réussi, pas encore propre : l’intervalle ne s’allonge pas. ${nextCheck(r.due, now)}` : 'Réussi, pas encore propre.');
  else if (code === 'H') out.push(checked ? 'Réussi avec indice : un contrôle se passe sans aide.' : 'Réussi avec indice. L’indice ne coûte que la série, pas le palier.');
  else if ((code === 'F' || code === 'A') && r.level < b.level && !isKnown(b.st)) out.push(`Retour au palier ${r.level + 1}/${top + 1} pour consolider.`);
  // 3. Contrôle manqué.
  if (b.st === 'mast' && r.st === 'rusty') out.push(`${B('À reprendre')} : 2 parties propres d’affilée suffiront.`);
  else if (b.st === 'acq' && r.st === 'learn') out.push('Contrôle manqué : 2 parties propres d’affilée suffiront pour le retrouver.');
  return out.join(' ');
}
