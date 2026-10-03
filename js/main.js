import { load, exportProgress, importProgress, h, $ } from './util.js';
import * as finales from './modules/finales.js';
import * as menace from './modules/menace.js';
import * as puzzles from './modules/puzzles.js';

const app = document.getElementById('app');
let cleanup = null;

function home() {
  const s = load();
  const fin = Object.values(s.finales).reduce((a, r) => ({ t: a.t + r.tries, w: a.w + r.wins }), { t: 0, w: 0 });
  const men = (s.stats && s.stats.menace) || { done: 0, spotted: 0, parried: 0 };
  const pz = Object.values(s.puzzles);
  const pzOk = pz.filter(r => r.box > 0).length, pzReview = pz.filter(r => r.box === 0).length;
  const today = new Date().toISOString().slice(0, 10);
  const week = [...Array(7)].map((_, i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  const activeDays = week.filter(d => s.days[d]).length;

  const view = h(`
    <div class="home">
      <header class="masthead">
        <h1>Mon manuel d’échecs</h1>
        <p>Étape 1 : stopper les gaffes. Objectif : progresser en rapide 10+0 et 10+10.</p>
      </header>

      <section class="checklist" aria-label="Checklist avant chaque coup">
        <h2>Avant chaque coup</h2>
        <ol>
          <li>Que menace le dernier coup adverse ?</li>
          <li>Ma case d’arrivée est-elle sûre ?</li>
          <li>Que protégeait ma pièce avant de bouger ?</li>
        </ol>
      </section>

      <nav class="modules">
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
        <a href="#/finales" class="module">
          <span class="module-name">Finales de base</span>
          <span class="module-desc">Mater avec deux tours, la dame ou la tour, depuis des positions au hasard, contre Stockfish.</span>
          <span class="module-stat">${fin.t ? `${fin.w} mats réussis sur ${fin.t} essais` : 'Pas encore commencé'}</span>
        </a>
      </nav>

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
}

const routes = { '': home, finales: finales.mount, menace: menace.mount, puzzles: puzzles.mount };

function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const key = location.hash.replace(/^#\/?/, '');
  const fn = routes[key] || home;
  cleanup = fn === home ? (home(), null) : fn(app);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
