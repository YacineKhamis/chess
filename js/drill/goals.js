// Types d'objectifs : mat, promotion, gain du pion, tenir la nulle, gain de matériel (spec §2.4 et §2.5).
import { balance, pieces, other } from '../analysis.js';
import { yourPiece } from '../util.js';

const cap = s => s[0].toUpperCase() + s.slice(1);
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
// goal.n peut dépendre du palier (images de mat : mat en 1 puis en 2).
export const goalN = (goal, level = 0) => (typeof goal.n === 'function' ? goal.n(level) : goal.n);
export const win = (reason, extra = {}) => ({ status: 'success', reason, ...extra });
export const fail = (reason, extra = {}) => ({ status: 'fail', reason, ...extra });
const nonPawn = (chess, color) => pieces(chess, color).filter(p => p.type !== 'k' && p.type !== 'p');
const bareKing = (chess, color) => pieces(chess, color).length === 1;
const noPawns = chess => !pieces(chess).some(p => p.type === 'p');

// Fin de partie par les règles, après chaque demi-coup. `by` = qui vient de jouer.
export function rules(st, by) {
  const c = st.chess, kind = st.spec.goal.kind, hold = kind === 'hold';
  if (c.isCheckmate()) return by === 'user' ? win('Échec et mat !') : fail('Tu es mat.');
  if (c.isStalemate()) {
    if (hold) return win('Pat : partie nulle, tu as tenu.');
    return fail(by === 'user' ? 'Pat : le roi adverse n’a plus de coup légal mais n’est pas en échec. Partie nulle.' : 'Pat : partie nulle.', { tag: 'stalemate' });
  }
  if (c.isInsufficientMaterial()) {
    if (hold) return win('Il ne reste plus assez de matériel pour mater : nulle, tu as tenu.');
    if (kind === 'promote') {
      const last = c.history({ verbose: true }).at(-1);
      if (by === 'user' && last && (last.promotion === 'n' || last.promotion === 'b'))
        return fail(`Promotion en ${last.promotion === 'n' ? 'cavalier' : 'fou'} : il ne reste pas assez de matériel pour mater, partie nulle.`, { tag: 'underpromo' });
      return fail('Ton pion est tombé : partie nulle.', { tag: 'piece-lost' });
    }
    return fail('Ta pièce a été prise : vérifie toujours qu’elle est protégée quand le roi s’approche.', { tag: 'piece-lost' });
  }
  if (c.isThreefoldRepetition()) return hold ? win('Répétition de la position : nulle, tu as tenu.') : fail('Tu tournes en rond : la même position est revenue trois fois.');
  if (c.isDrawByFiftyMoves()) return hold ? win('Règle des 50 coups : nulle, tu as tenu.') : fail('Nulle par la règle des 50 coups : il faut resserrer plus vite.');
  return null;
}

export function moveCap(spec, st) {
  if (typeof spec.moveCap === 'function') return spec.moveCap(st.ref);
  if (typeof spec.moveCap === 'number') return spec.moveCap;
  if (spec.goal.kind === 'mate' && !spec.goal.n) return st.ref ? 2 * st.ref + 10 : 40;
  if (spec.goal.kind === 'promote' || spec.goal.kind === 'capture') return st.ref ? 2 * st.ref + 10 : 40;
  return null;
}
export const slackMate = r => Math.max(2, Math.ceil(r / 4));
export const slackPromo = r => Math.max(3, Math.ceil(r / 3));

// Victoire « par signature » : plus de pions, l'adversaire n'a plus que son roi et toi une dame ou une tour.
function wonSignature(st) {
  const c = st.chess, me = st.userColor;
  return noPawns(c) && bareKing(c, other(me)) && nonPawn(c, me).some(p => p.type === 'q' || p.type === 'r');
}

export const GOALS = {
  mate: {
    text: (spec, st) => (spec.goal.n ? `Mat en ${goalN(spec.goal, st.level)}.` : `Mate le roi ${st.userColor === 'w' ? 'noir' : 'blanc'}.`),
    afterVerdict(st, j) {
      const n = goalN(st.spec.goal, st.level);
      if (n && j.mate != null) {
        if (st.userMoves + j.mate > n) st.late = true;
        if (st.userMoves > n + 2) return fail(`Trop long : le mat devait venir en ${n} coups.`);
      }
      return null;
    },
    afterOpponent(st, mv) {
      if (st.spec.goal.guard === 'pieces' && mv.captured && mv.captured !== 'p') return fail(`${cap(yourPiece(mv.captured))} a été prise.`, { tag: 'piece-lost' });
      return null;
    },
    clean(st) {
      if (st.spec.goal.n) return st.userMoves <= goalN(st.spec.goal, st.level) && !st.late;
      return !st.ref || st.userMoves <= st.ref + slackMate(st.ref);
    },
  },

  promote: {
    text: () => 'Va à dame en sécurité.',
    afterVerdict(st, j, mv) {
      if (mv.promotion && j.cls === 'ok') return win(mv.promotion === 'q' ? 'Promotion réussie : la nouvelle dame est en sécurité.' : 'Promotion réussie, et sans pat.');
      return null;
    },
    afterAny: st => (wonSignature(st) ? win('Gagné : l’adversaire n’a plus que son roi.') : null),
    clean: st => !st.ref || st.userMoves <= st.ref + slackPromo(st.ref),
  },

  capture: {
    text: () => 'Gagne le pion sans perdre ta pièce.',
    afterUser(st) {
      const c = st.chess, me = st.userColor;
      if (pieces(c, other(me)).some(p => p.type === 'p') || !nonPawn(c, me).length) return null;
      const tb = st.ctx.tb, sig = tb && tb.signature(c.fen());
      if (sig) return tb.probe(c.fen())?.win ? win('Pion gagné, et ta pièce est à l’abri : la suite est un mat de base.') : null;
      return null; // le verdict du moteur tranchera
    },
    afterAny: st => (wonSignature(st) ? win('Pion gagné : il ne reste que le mat de base.') : null),
    clean: () => true,
  },

  hold: {
    text: (spec, st) => (spec.goal.band === 'keep'
      ? `Que menace l’adversaire ? Pare la menace et garde ton avantage (${plural(goalN(spec.goal, st.level), 'coup')}).`
      : `Tiens la nulle pendant ${plural(goalN(spec.goal, st.level), 'coup')}.`),
    afterAny(st) {
      if (st.spec.oracle !== 'engine') return null;
      const c = st.chess, me = st.userColor;
      if (noPawns(c)) {
        const key = col => nonPawn(c, col).map(p => p.type).sort().join('');
        if (key(me) === key(other(me))) return win('Matériel égal sans pions : c’est nulle, tu as tenu.');
      }
      const tb = st.ctx.tb, sig = tb && tb.signature(c.fen());
      if (sig && sig.sig === 'KPK' && sig.strong !== me && tb.probe(c.fen()) && !tb.probe(c.fen()).win) return win('Finale roi et pion nulle : tu as tenu.');
      return null;
    },
    afterVerdict(st) {
      const n = goalN(st.spec.goal, st.level);
      if (st.userMoves >= n) return win(st.spec.goal.band === 'keep' ? 'Menace parée et avantage conservé.' : `Tu as tenu ${plural(n, 'coup')} : nulle !`);
      return null;
    },
    clean: () => true,
  },

  material: {
    text: () => 'Gagne du matériel.',
    afterOpponent(st) {
      const g = st.spec.goal, d = balance(st.chess, st.userColor) - st.M0, v = st.lastV;
      const gain = typeof g.gain === 'function' ? g.gain(st) : g.gain;
      if (d >= gain && v != null && v >= (st.Ealt ?? 0) + 150) return win(`Matériel gagné : +${d}.`);
      if (st.userMoves >= g.within) {
        if (v != null && v >= (st.Ealt ?? 0) + 250 && d >= 1) return win('Réussi par un autre chemin.', { quality: 'other' });
        return fail('Trop lent : le gain n’est pas venu.');
      }
      return null;
    },
    clean: st => !st.k || st.userMoves <= st.k + 1,
  },
};
