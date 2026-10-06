// Famille « tactic:pin » (exercice clouage) : attaquer une pièce clouée avec moins cher qu'elle.
import { family, tacticOrder } from '../rules.js';

export default family({
  id: 'tactic:pin',
  rules: tacticOrder('pin'),
  warnings: [],
  mistakes: ['missed-mate', 'allows-mate', 'stalemate', 'bad-capture', 'piece-lost', 'allows-fork', 'missed-motif'],
  fallback: { idea: 'Une pièce clouée ne peut pas fuir : attaque-la.', say: 'La pièce clouée ne peut pas s’échapper : continue de l’attaquer.' },
});
