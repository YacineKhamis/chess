// Catalogue des exercices : un fichier par parcours, chacun exporte une liste de spécifications (spec §1.4).
import mats from './mats.js';
import pions from './pions.js';
import pieces from './pieces.js';
import tours from './tours.js';
import tactique from './tactique.js';
import images from './images.js';
import vigilance from './vigilance.js';

export const TRACKS = [
  { id: 'mats', title: 'Mats de base', desc: 'Mater le roi seul, puis avec des pions bloqués sur l’échiquier.' },
  { id: 'pions', title: 'Finales de pions', desc: 'Le carré, l’opposition, les cases clés : gagner ou tenir avec roi et pion.' },
  { id: 'pieces', title: 'Pièce contre pion', desc: 'Arrêter un pion passé avec la dame ou la tour.' },
  { id: 'tours', title: 'Finales de tours', desc: 'Les deux positions à connaître : Lucena pour gagner, Philidor pour tenir.' },
  { id: 'tactique', title: 'Motifs tactiques', desc: 'Un motif à la fois, d’abord isolé, puis caché parmi d’autres pièces.' },
  { id: 'images', title: 'Images de mat', desc: 'Les mats qui reviennent sans cesse, vus sous tous les angles.' },
  { id: 'vigilance', title: 'Vigilance', desc: 'Voir la menace adverse avant de jouer son plan.' },
];

export const DRILL_LIST = [...mats, ...pions, ...pieces, ...tours, ...tactique, ...images, ...vigilance];
export const DRILLS = Object.fromEntries(DRILL_LIST.map(d => [d.id, d]));

// Ordre conseillé : environ un pas sur trois est tactique (spec §4.6). Les exercices absents sont ignorés.
export const PARCOURS = [
  'mat-deux-tours', 'mat-dame', 'piece-en-prise', 'mat-tour', 'mat-couloir', 'pion-carre',
  'pion-roi-devant', 'fourchette-cavalier', 'pion-opposition', 'parer-couloir', 'pion-cases-cles', 'mat-dame-pions',
  'enfilade', 'pion-defense', 'mat-etouffe', 'mat-tour-pions', 'clouage', 'pion-tour',
  'dame-contre-pion', 'mat-dame-fou', 'tour-contre-pion', 'dame-contre-pion-nulle', 'lucena', 'philidor',
].filter(id => DRILLS[id]);

// Pour chaque exercice, ceux qui l'englobent (« covers »).
export const coveredBy = {};
for (const d of DRILL_LIST) for (const x of d.covers || []) (coveredBy[x] ||= []).push(d.id);

export const REGISTRY = { byId: DRILLS, list: DRILL_LIST, parcours: PARCOURS, coveredBy, tracks: TRACKS };
