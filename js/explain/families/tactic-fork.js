// Famille « tactic:fork » (exercice fourchette-cavalier) : une pièce attaque deux cibles à la fois.
import { family, tacticOrder } from '../rules.js';

export default family({
  id: 'tactic:fork',
  rules: tacticOrder('fork'),
  warnings: [],
  mistakes: ['missed-mate', 'allows-mate', 'stalemate', 'bad-capture', 'piece-lost', 'allows-fork', 'missed-motif'],
  fallback: { idea: 'Cherche une case d’où ta pièce attaquerait deux cibles à la fois.', say: 'Après la fourchette, récupère la pièce qui ne peut plus fuir.' },
});
