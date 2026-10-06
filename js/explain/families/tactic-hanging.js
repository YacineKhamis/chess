// Famille « tactic:hanging » (exercice piece-en-prise) : prendre ce qui n'est pas défendu, mais pas un leurre protégé.
import { family, tacticOrder } from '../rules.js';

export default family({
  id: 'tactic:hanging',
  rules: tacticOrder('hanging-take'),
  warnings: [],
  mistakes: ['missed-mate', 'allows-mate', 'stalemate', 'bad-capture', 'piece-lost', 'allows-fork', 'missed-motif'],
  fallback: { idea: 'Regarde ce que l’adversaire laisse sans défense.', say: 'Avant tout, compte les défenseurs de chaque pièce adverse attaquée.' },
});
