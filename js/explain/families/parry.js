// Famille « parry » (vigilance, parer-couloir) : voir la menace adverse avant de jouer son plan.
import { family, tacticOrder } from '../rules.js';

export default family({
  id: 'parry',
  rules: tacticOrder('parry-threat'),
  warnings: [],
  mistakes: ['allows-mate', 'missed-mate', 'stalemate', 'bad-capture', 'piece-lost', 'allows-fork'],
  fallback: { idea: 'Que menace son dernier coup ?', say: 'Avant ton plan, vérifie ce que l’adversaire menace.' },
});
