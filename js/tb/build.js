// Construction rétrograde des tables exactes KQK, KRK (distance au mat) et KPK (distance à la promotion sûre).
// Outil Node (tools/build_tb.mjs) et tests : tableaux typés, aucun objet par position.
// Index brut : i = (wk·64 + bk)·64 + x, blanc = camp fort. W = blanc au trait, B = noir au trait.
// Valeurs : −2 illégal, −1 nulle (ou inconnu pendant le calcul), k ≥ 0 = gain en k coups blancs (B = 0 : noir est mat).
import { R, adj, KING, attacks, slides, TRI } from './probe.js';

const N = 64 * 64 * 64, ILL = -2, DRAWN = 255;
const I = (wk, bk, x) => (wk << 12) | (bk << 6) | x;

// Résout une finale roi + pièce `p` ('Q', 'R', 'P') contre roi.
// Pour 'P', `promo` = { Q, R } (tableaux B des finales KQK et KRK) : une promotion est sûre si la position
// obtenue, noir au trait, est gagnée. W compte alors les coups jusqu'à cette promotion, promotion comprise.
export function solve(p, promo = null) {
  const W = new Int16Array(N).fill(-1), B = new Int16Array(N).fill(-1);
  const cnt = new Uint8Array(N); // coups noirs non résolus ; DRAWN = noir a une prise ou est pat
  let front = [];
  for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let x = 0; x < 64; x++) {
    const i = I(wk, bk, x);
    if (wk === bk || wk === x || bk === x || adj(wk, bk) || (p === 'P' && (R(x) === 0 || R(x) === 7))) { W[i] = B[i] = ILL; continue; }
    const chk = attacks(p, x, bk, wk);
    if (chk) W[i] = ILL; // blanc au trait avec le roi noir en échec
    let n = 0, cap = false;
    for (const t of KING[bk]) {
      if (t === wk || adj(t, wk)) continue;
      if (t === x) { if (!adj(x, wk)) cap = true; continue; }
      if (!attacks(p, x, t, wk)) n++;
    }
    if (cap || (!n && !chk)) cnt[i] = DRAWN;
    else if (!n) { B[i] = 0; front.push(i); } // mat
    else cnt[i] = n;
  }
  // KPK : positions (blanc au trait) avec une promotion sûre = niveau 1.
  const seeds = [];
  if (p === 'P') for (let i = 0; i < N; i++) {
    if (W[i] !== -1) continue;
    const wk = i >> 12, bk = (i >> 6) & 63, x = i & 63, y = x + 8;
    if (R(x) === 6 && y !== wk && y !== bk && (promo.Q[I(wk, bk, y)] >= 0 || promo.R[I(wk, bk, y)] >= 0)) seeds.push(i);
  }
  for (let k = 1; ; k++) {
    const nw = [];
    const visitW = q => { if (W[q] === -1) { W[q] = k; nw.push(q); } };
    // Prédécesseurs blancs des positions noires perdues en k − 1 : on « défait » un coup blanc.
    for (const j of front) {
      const wk = j >> 12, bk = (j >> 6) & 63, x = j & 63;
      for (const f of KING[wk]) visitW(I(f, bk, x)); // les cases occupées ou au contact sont illégales (W = −2)
      if (p === 'P') {
        if (R(x) >= 2 && x - 8 !== wk && x - 8 !== bk) {
          visitW(I(wk, bk, x - 8));
          if (R(x) === 3 && x - 16 !== wk && x - 16 !== bk) visitW(I(wk, bk, x - 16));
        }
      } else slides(p, x, wk, bk, y => visitW(I(wk, bk, y)));
    }
    if (k === 1) seeds.forEach(visitW);
    if (!nw.length) break;
    // Prédécesseurs noirs : un coup de roi noir de moins à réfuter ; à zéro, la position noire est perdue en k.
    const nb = [];
    for (const q of nw) {
      const wk = q >> 12, bk = (q >> 6) & 63, x = q & 63;
      for (const f of KING[bk]) {
        const r = I(wk, f, x);
        if (B[r] === -1 && cnt[r] !== DRAWN && --cnt[r] === 0) { B[r] = k; nb.push(r); }
      }
    }
    front = nb;
  }
  return { W, B };
}

// Format KQK/KRK : roi blanc dans le triangle TRI, blanc au trait.
export function packKXK(W) {
  const out = new Uint8Array(TRI.length * 4096);
  TRI.forEach((wk, t) => {
    for (let bk = 0; bk < 64; bk++) for (let x = 0; x < 64; x++) {
      const v = W[I(wk, bk, x)];
      out[(t * 64 + bk) * 64 + x] = v === ILL ? 255 : v < 0 ? 0 : v;
    }
  });
  return out;
}

// Format KPK : pion en colonnes a–d, rangées 2–7, blanc au trait.
export function packKPK(W) {
  const out = new Uint8Array(64 * 64 * 24);
  for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let r = 1; r <= 6; r++) for (let f = 0; f < 4; f++) {
    const v = W[I(wk, bk, r * 8 + f)];
    out[(wk * 64 + bk) * 24 + (r - 1) * 4 + f] = v === ILL ? 255 : v < 0 ? 0 : v;
  }
  return out;
}

// Les trois tables au format des fichiers data/tb/*.bin (+ tables brutes pour les tests).
export function buildAll() {
  const q = solve('Q'), r = solve('R'), k = solve('P', { Q: q.B, R: r.B });
  return { kqk: packKXK(q.W), krk: packKXK(r.W), kpk: packKPK(k.W), raw: { KQK: q, KRK: r, KPK: k } };
}
