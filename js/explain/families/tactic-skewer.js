// Famille « tactic:skewer » (exercice enfilade) : échec sur la ligne, la pièce derrière le roi tombe.
import { family, tacticOrder } from '../rules.js';

export default family({
  id: 'tactic:skewer',
  rules: tacticOrder('skewer'),
  warnings: [],
  mistakes: ['missed-mate', 'allows-mate', 'stalemate', 'bad-capture', 'piece-lost', 'allows-fork', 'missed-motif'],
  fallback: { idea: 'Le roi adverse et une pièce derrière lui sont-ils alignés ?', say: 'Après l’enfilade, prends la pièce restée derrière le roi.' },
});
