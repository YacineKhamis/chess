// Tables exactes dans Node : lecture de data/tb/*.bin depuis le disque.
import { readFile } from 'node:fs/promises';
import { loadTB } from '../../js/tb/probe.js';

const DIR = new URL('../../data/tb/', import.meta.url);
let cached = null;
export function loadTBFromFs() {
  return (cached ||= loadTB(name => readFile(new URL(name + '.bin', DIR))));
}
