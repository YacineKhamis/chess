// Séance du jour : enchaîne contrôles, exercice en cours, nouveauté et mélange (spec §4.6 et §4.7).
import { load, save, h, $, setText } from '../util.js';
import { DRILLS, REGISTRY } from '../drills/index.js';
import * as P from '../progress.js';
import { mount as mountDrill } from './drill.js';

const KIND = { controle: 'Contrôle', reprise: 'À reprendre', focus: 'En cours', nouveau: 'Nouveau', melange: 'Mélange' };
const KNOWN = ['acq', 'mast', 'rusty'];

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
    const id = it.kind === 'melange' ? P.pickMelange(store, REGISTRY, current) : it.id;
    if (!id || !DRILLS[id]) { se.i++; se.done = 0; save(); return run(); }
    current = id;
    suite.hidden = true;
    setText(step, `Séance · ${se.i + 1}/${se.items.length} · ${KIND[it.kind] || ''} · partie ${Math.min(se.done + 1, it.n)}/${it.n}`);
    // Dans un bloc « en cours », une partie sur quatre repart d'une de tes erreurs passées.
    const errs = store.drills?.[id]?.err || [];
    const replayItem = it.kind === 'focus' && errs.length && se.done % 4 === 3 ? errs[errs.length - 1] : null;
    child = mountDrill(body, id, {
      replayItem,
      mystery: it.kind === 'melange',
      onDone: code => {
        if (!code || code === 'R') return;   // parties « hors série » : elles ne comptent pas dans la séance
        se.done++;
        // Trois échecs de suite dans le bloc en cours : on change d'air.
        const brk = it.kind === 'focus' ? P.focusBreak(store, DRILLS[id], se.done) : null;
        if (brk) se.done = it.n;
        save();
        const done = itemDone(it);
        setText(step, brk || `Séance · ${se.i + 1}/${se.items.length} · ${KIND[it.kind] || ''} · ${done ? 'terminé' : `partie ${se.done + 1}/${it.n}`}`);
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
