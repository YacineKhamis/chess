// Famille générique « * » : toute famille sans greffon (kpk, lucena… en attendant le leur).
// Seulement des faits sûrs partout : mat, sauvetage, motifs tactiques, échec, prise, boîte et roi (finales de mat), suite.
import { family } from '../rules.js';

export default family({
  id: '*',
  rules: ['mate', 'rescue', 'mate-every-reply', 'promote', 'double-check', 'fork', 'skewer', 'pin', 'hanging-take', 'parry-threat',
    'mate-threat', 'box-shrink', 'driving-check', 'approach', 'passed-push', 'lookahead', 'check', 'capture'],
  warnings: ['underpromo', 'stalemate-danger'],
  mistakes: ['stalemate', 'missed-mate', 'allows-mate', 'bad-capture', 'piece-lost', 'missed-motif'],
  fallback: null,
});
