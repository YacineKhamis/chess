// Famille « mate-pic » (images de mat : couloir, étouffé, batterie dame-fou).
import { family, tacticOrder } from '../rules.js';

export default family({
  id: 'mate-pic',
  rules: tacticOrder(),
  warnings: [],
  mistakes: ['missed-mate', 'allows-mate', 'stalemate', 'piece-lost', 'missed-motif'],
  fallback: { idea: 'Cherche les échecs : le roi adverse a très peu de cases.', say: 'Le roi adverse est enfermé : cherche l’échec qui lui enlève sa dernière case.' },
});
