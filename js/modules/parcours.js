// Page « Parcours » : les exercices par thème, leur état et la prochaine étape conseillée.
import { load, h } from '../util.js';
import { TRACKS, DRILL_LIST, REGISTRY, PARCOURS, DRILLS } from '../drills/index.js';
import * as P from '../progress.js';

const SYMBOL = { new: '○', learn: '◐', acq: '●', mast: '★', rusty: '↺' };
const KNOWN = ['acq', 'mast', 'rusty'];

export const HOWTO = `
  <details class="howto">
    <summary>Comment ça marche ?</summary>
    <ul>
      <li><strong>Une idée par exercice.</strong> Les positions changent à chaque partie mais restent équivalentes : c’est la répétition qui fait apparaître les motifs.</li>
      <li><strong>Propre</strong> = sans indice et dans la limite de coups.</li>
      <li><strong>Acquis</strong> = 3 parties propres d’affilée au dernier palier, avec les Blancs et avec les Noirs.</li>
      <li><strong>Maîtrisé</strong> = encore propre après une nuit.</li>
      <li>Ensuite, un contrôle de temps en temps, de plus en plus espacé. Un raté ? L’exercice revient plus vite.</li>
    </ul>
  </details>`;

// Premier exercice du parcours conseillé qui n'est pas encore acquis et dont les prérequis le sont.
export function hereId(store) {
  return PARCOURS.find(id => {
    const st = store.drills?.[id]?.st || 'new';
    return (st === 'new' || st === 'learn') && P.prereqOk(store, REGISTRY, id);
  }) || null;
}

function card(store, d, here) {
  const r = store.drills?.[d.id];
  const st = r?.st || 'new';
  const top = d.levels.length - 1;
  let sub;
  if (KNOWN.includes(st)) sub = `${P.stateLabel(st)} · contrôle ${P.dueLabel(r.due, Date.now())}`;
  else if (r) sub = `${d.levels.length > 1 ? `Palier ${Math.min(r.level ?? 0, top) + 1}/${top + 1} · ` : ''}série ${P.streakDots(r, r.need ?? d.need ?? 3)}`;
  else sub = d.levels.length > 1 ? `${d.levels.length} paliers` : 'Nouveau';
  const dim = !KNOWN.includes(st) && st !== 'learn' && !P.prereqOk(store, REGISTRY, d.id);
  return `
    <li><a class="drill-card${dim ? ' dim' : ''}${here ? ' here' : ''}" href="#/drill/${d.id}" data-st="${st}">
      <span class="sym" aria-hidden="true">${SYMBOL[st]}</span>
      <span class="drill-name">${d.title}${here ? ' <em>Tu es ici</em>' : ''}</span>
      <span class="drill-sub">${sub}</span>
    </a></li>`;
}

export function mount(root) {
  const store = load();
  const here = hereId(store);
  const sum = P.trackSummary(store, REGISTRY);
  const view = h(`
    <section class="parcours">
      <a class="back" href="#/">Retour au sommaire</a>
      <h1>Parcours d’exercices</h1>
      <p class="lead">${sum.acq + sum.mast ? `${sum.acq + sum.mast} acquis, ` : ''}${sum.learn ? `${sum.learn} en cours, ` : ''}${DRILL_LIST.length} exercices en tout.${here ? ` Prochaine étape conseillée : <a href="#/drill/${here}">${DRILLS[here].title}</a>.` : ''}</p>
      ${HOWTO}
      ${TRACKS.map(t => {
        const ds = DRILL_LIST.filter(d => d.track === t.id);
        if (!ds.length) return '';
        return `<section class="track"><h2>${t.title}</h2><p class="track-desc">${t.desc}</p><ol class="drills">${ds.map(d => card(store, d, d.id === here)).join('')}</ol></section>`;
      }).join('')}
    </section>`);
  root.replaceChildren(view);
  return null;
}
