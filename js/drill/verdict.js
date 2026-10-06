// Seuils et verdict « ton coup laisse filer… » (spec §2.2 et §2.3). Valeurs du point de vue de l'utilisateur, en centipions.
export const MATE = 9000;
export const isMateFor = v => v != null && v >= MATE;
export const mateIn = v => (isMateFor(v) ? Math.round((10000 - v) / 10) : null);

export function bandOf(goal) {
  if (goal.kind === 'mate') return goal.n ? 'mateN' : 'win';
  if (goal.kind === 'hold') return goal.band || 'draw';
  if (goal.kind === 'material') return 'material';
  return 'win'; // promote, capture
}

export function thresholds(spec, st) {
  const band = bandOf(spec.goal);
  let t;
  switch (band) {
    case 'win': t = { ok: 300, lost: 100 }; break;
    case 'draw': t = { ok: -100, lost: -300 }; break;
    case 'keep': t = { ok: st.E0 - 120, lost: st.E0 - 250 }; break;
    case 'material': {
      const lost = st.E0 - Math.max(200, (st.E0 - (st.Ealt ?? st.E0 - 400)) / 2);
      t = { ok: lost + 50, lost };
      break;
    }
    case 'mateN': t = { ok: MATE, lost: MATE - 1 }; break;
  }
  return { band, confirmMs: 1200, ...t, ...(spec.thresholds || {}) };
}

// Classe une valeur : 'ok', 'grey' (pas de verdict) ou 'lost'.
export const classify = (v, t) => (v <= t.lost ? 'lost' : v >= t.ok ? 'ok' : 'grey');

// Textes d'échec quand le verdict tombe.
export function lostText(spec, oracle) {
  const band = bandOf(spec.goal);
  if (band === 'win') return oracle === 'tb' ? 'Ce coup laisse filer le gain : la position est maintenant nulle.' : 'Ce coup laisse filer le gain.';
  if (band === 'draw') return 'Ce coup perd : la nulle n’est plus là.';
  if (band === 'keep') return 'La menace passe : ce coup ne la pare pas.';
  if (band === 'material') return 'L’avantage a disparu.';
  return 'Le mat s’est envolé.';
}
