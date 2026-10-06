// Séance du jour : enchaîne contrôles, exercice en cours, nouveauté et mélange (spec §4.6 et §4.7).
import { load, save, h, $, setText } from '../util.js';
import { DRILLS, DRILL_LIST, REGISTRY, coveredBy } from '../drills/index.js';
import * as P from '../progress.js';
import { mount as mountDrill } from './drill.js';

const KIND = { controle: 'Contrôle', reprise: 'À reprendre', focus: 'En cours', nouveau: 'Nouveau', melange: 'Mélange' };
const KNOWN = ['acq', 'mast', 'rusty'];

// Tirage pondéré d'un exercice pour le mélange : jamais deux fois le même parcours d'affilée,
// une fois sur deux le « contraste » du précédent quand il existe.
export function pickMelange(store, prev, rng = Math.random, now = Date.now()) {
  const known = id => KNOWN.includes(store.drills?.[id]?.st);
  const pool = DRILL_LIST.filter(d => (store.drills?.[d.id]?.st === 'acq' || store.drills?.[d.id]?.st === 'mast')
    && !(coveredBy[d.id] || []).some(known));
  if (!pool.length) return null;
  const p = prev && DRILLS[prev];
  if (p && rng() < 0.5) {
    const c = (p.contrast || []).filter(id => pool.some(d => d.id === id));
    if (c.length) return c[Math.floor(rng() * c.length)];
  }
  const cand = pool.filter(d => !p || d.track !== p.track || pool.length === 1);
  const weight = d => {
    const r = store.drills[d.id];
    const ratio = r.due && r.lastChk ? (now - r.lastChk) / Math.max(1, r.due - r.lastChk) : 1;
    return Math.min(3, Math.max(0.3, ratio));
  };
  const total = cand.reduce((s, d) => s + weight(d), 0);
  let x = rng() * total;
  for (const d of cand) { x -= weight(d); if (x <= 0) return d.id; }
  return cand.at(-1).id;
}

export function mount(root) {
  const store = load();
  const today = P.dayStr(Date.now());
  if (!store.seance || store.seance.date !== today || !store.seance.items?.length) {
    store.seance = { date: today, items: P.planSeance(store, REGISTRY, Date.now()), i: 0, done: 0 };
    save();
  }
  const se = store.seance;
  let child = null, current = null;

  const view = h(`
    <section class="seance">
      <div class="seance-bar">
        <a class="back" href="#/">Sommaire</a>
        <span class="seance-step"></span>
        <button class="btn primary" data-act="suite" hidden>Suite de la séance ›</button>
      </div>
      <div class="seance-body"></div>
    </section>`);
  root.replaceChildren(view);
  const body = $('.seance-body', view), step = $('.seance-step', view), suite = $('[data-act="suite"]', view);

  function finished() {
    if (child) { child(); child = null; }
    setText(step, 'Séance terminée');
    suite.hidden = true;
    body.replaceChildren(h(`<div class="home"><p class="lead">Séance terminée, bravo. Tout ce qui devait être revu l’a été.</p><p><a class="btn primary" href="#/parcours">Voir le parcours</a> <a class="btn" href="#/">Sommaire</a></p></div>`));
  }

  function itemDone(it) {
    if (se.done >= it.n) return true;
    const st = it.id && store.drills?.[it.id]?.st;
    if (it.until === 'acq' && KNOWN.includes(st)) return true;
    if (it.until === 'mast' && st === 'mast') return true;
    return false;
  }

  function run() {
    if (child) { child(); child = null; }
    const it = se.items[se.i];
    if (!it) return finished();
    const id = it.kind === 'melange' ? pickMelange(store, current) : it.id;
    if (!id || !DRILLS[id]) { se.i++; se.done = 0; save(); return run(); }
    current = id;
    suite.hidden = true;
    setText(step, `Séance · ${se.i + 1}/${se.items.length} · ${KIND[it.kind] || ''} · partie ${Math.min(se.done + 1, it.n)}/${it.n}`);
    child = mountDrill(body, id, {
      mystery: it.kind === 'melange',
      onDone: () => {
        se.done++;
        save();
        const done = itemDone(it);
        setText(step, `Séance · ${se.i + 1}/${se.items.length} · ${KIND[it.kind] || ''} · ${done ? 'terminé' : `partie ${se.done + 1}/${it.n}`}`);
        if (done || it.kind === 'melange') suite.hidden = false;
        if (done) setText(suite, se.i + 1 < se.items.length ? 'Suite de la séance ›' : 'Terminer la séance');
        else if (it.kind === 'melange') setText(suite, 'Exercice suivant ›');
      },
    });
  }

  suite.addEventListener('click', () => {
    const it = se.items[se.i];
    if (it && itemDone(it)) { se.i++; se.done = 0; }
    save();
    run();
  });

  run();
  return () => { if (child) child(); child = null; };
}
