import { load, exportProgress, importProgress, h, $ } from './util.js';
import * as menace from './modules/menace.js';
import * as puzzles from './modules/puzzles.js';
import * as drill from './modules/drill.js';
import * as parcours from './modules/parcours.js';
import * as seance from './modules/seance.js';
import { DRILLS, DRILL_LIST, REGISTRY } from './drills/index.js';
import * as P from './progress.js';

const app = document.getElementById('app');
let cleanup = null;

const KIND = {
  controle: ['↺', 'Contrôle'], reprise: ['↺', 'À reprendre'], focus: ['▶', 'En cours'],
  nouveau: ['✦', 'Nouveau'], melange: ['⤨', 'Mélange'],
};

function seanceCard(s) {
  const items = P.planSeance(s, REGISTRY, Date.now());
  if (!items.length) {
    return `<section class="seance-card"><h2>Séance du jour</h2><p>Tout est à jour. ${P.nextDueText ? P.nextDueText(s, REGISTRY, Date.now()) : ''}</p>
      <p><a class="btn" href="#/parcours">Voir le parcours</a></p></section>`;
  }
  const line = it => {
    const [sym, label] = KIND[it.kind] || ['•', ''];
    if (it.kind === 'melange') return `<li><span class="sym">${sym}</span> ${label} — ${it.n} exercices déjà acquis, sans dire lesquels</li>`;
    const d = DRILLS[it.id], r = s.drills?.[it.id];
    let extra = '';
    if (it.kind === 'focus' && r) {
      const top = d.levels.length - 1;
      extra = `${d.levels.length > 1 ? ` · palier ${Math.min(r.level ?? 0, top) + 1}/${top + 1}` : ''} · série ${P.streakDots(r, r.need ?? d.need ?? 3)}`;
    }
    return `<li><span class="sym">${sym}</span> ${label} — ${d.title}${extra}</li>`;
  };
  return `
    <section class="seance-card">
      <h2>Séance du jour</h2>
      <ul class="seance-items">${items.map(line).join('')}</ul>
      <p class="actions"><a class="btn primary" href="#/seance">Commencer la séance</a> <a class="btn ghost" href="#/parcours">Ou choisir moi-même : Parcours ›</a></p>
    </section>`;
}

function home() {
  const s = load();
  const men = (s.stats && s.stats.menace) || { done: 0, spotted: 0, parried: 0 };
  const pz = Object.values(s.puzzles);
  const pzOk = pz.filter(r => r.box > 0).length, pzReview = pz.filter(r => r.box === 0).length;
  const today = new Date().toISOString().slice(0, 10);
  const week = [...Array(7)].map((_, i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const activeDays = week.filter(d => s.days[d]).length;
  const sum = P.trackSummary(s, REGISTRY);
  const parcoursStat = sum.acq + sum.mast + sum.learn + sum.rusty
    ? `${sum.acq + sum.mast} acquis, ${sum.learn} en cours, ${sum.due + sum.rusty} à revoir`
    : `${DRILL_LIST.length} exercices, pas encore commencé`;

  const view = h(`
    <div class="home">
      <header class="masthead">
        <h1>Mon manuel d’échecs</h1>
        <p>Étape 1 : stopper les gaffes. Objectif : progresser en rapide 10+0 et 10+10.</p>
      </header>

      ${seanceCard(s)}

      <section class="checklist" aria-label="Checklist avant chaque coup">
        <h2>Avant chaque coup</h2>
        <ol>
          <li>Que menace le dernier coup adverse ? <a class="train" href="#/drill/parer-couloir">S’entraîner</a></li>
          <li>Ma case d’arrivée est-elle sûre ?</li>
          <li>Que protégeait ma pièce avant de bouger ?</li>
        </ol>
      </section>

      <nav class="modules">
        <a href="#/parcours" class="module">
          <span class="module-name">Parcours d’exercices</span>
          <span class="module-desc">Mats, finales de pions et de tours, motifs tactiques : une idée à la fois, répétée sur des positions toujours différentes.</span>
          <span class="module-stat">${parcoursStat}</span>
        </a>
        <a href="#/menace" class="module">
          <span class="module-name">Quelle est la menace ?</span>
          <span class="module-desc">Repérer ce que prépare le dernier coup adverse, puis le parer.</span>
          <span class="module-stat">${men.done ? `${men.spotted} menaces vues, ${men.parried} parées sur ${men.done}` : 'Pas encore commencé'}</span>
        </a>
        <a href="#/puzzles" class="module">
          <span class="module-name">Puzzles par thème</span>
          <span class="module-desc">Fourchette, clouage, pièce en prise, mats… un thème à la fois, les ratés reviennent.</span>
          <span class="module-stat">${pz.length ? `${pzOk} réussis, ${pzReview} à revoir` : 'Pas encore commencé'}</span>
        </a>
      </nav>

      ${parcours.HOWTO}

      <p class="activity">Aujourd’hui : ${s.days[today] || 0} exercice${(s.days[today] || 0) > 1 ? 's' : ''}. Jours actifs sur les 7 derniers : ${activeDays}.</p>

      <footer class="foot">
        <details>
          <summary>Sauvegarder ou transférer ma progression</summary>
          <p>Ta progression est enregistrée dans ce navigateur uniquement. Pour la copier vers un autre appareil, exporte-la ici puis importe le fichier là-bas.</p>
          <div class="actions">
            <button class="btn" data-act="export">Exporter</button>
            <label class="btn">Importer<input type="file" accept="application/json" hidden></label>
          </div>
        </details>
        <p class="credits">Moteur Stockfish (GPL-3). Puzzles issus de la base ouverte de Lichess. Pièces « cburnett » (CC BY-SA 3.0).</p>
      </footer>
    </div>`);

  view.addEventListener('click', e => {
    if (e.target.closest('[data-act="export"]')) {
      const blob = new Blob([exportProgress()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `progression-echecs-${today}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  });
  $('input[type=file]', view).addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { importProgress(await f.text()); route(); } catch { alert('Ce fichier n’est pas une sauvegarde valide.'); }
  });
  app.replaceChildren(view);
  return null;
}

const routes = {
  '': home,
  menace: root => menace.mount(root),
  puzzles: root => puzzles.mount(root),
  finales: (root, arg) => drill.mountFinales(root, arg),
  drill: (root, arg) => drill.mount(root, arg),
  parcours: root => parcours.mount(root),
  seance: root => seance.mount(root),
};

function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const [key, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = routes[key] || home;
  cleanup = fn(app, arg ? decodeURIComponent(arg) : undefined) || null;
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
