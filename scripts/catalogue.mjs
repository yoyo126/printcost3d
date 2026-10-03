// Fabrique les fichiers légers du catalogue de filaments (à relancer pour mettre à jour) :
//   node scripts/catalogue.mjs
// Sources :
//  - Bambu Lab : liste officielle des couleurs de Bambu Studio (noms en français, teintes exactes)
//    https://github.com/bambulab/BambuStudio/blob/master/resources/profiles/BBL/filament/filaments_color_codes.json
//  - Autres marques : SpoolmanDB (licence MIT, © Donkie) https://github.com/Donkie/SpoolmanDB
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'catalogue');
const BAMBU = 'https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL/filament/filaments_color_codes.json';
const SPOOLMAN = 'https://donkie.github.io/SpoolmanDB/filaments.json';

const slug = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hex = h => String(h || '').replace('#', '').slice(0, 6).toUpperCase();

fs.mkdirSync(path.join(OUT, 'm'), {recursive: true});

// Bambu Lab : [matière, nom FR, teintes séparées par des virgules, identifiant filament, code couleur, référence (code de l'étiquette)]
const bambu = (await (await fetch(BAMBU)).json()).data;
const colors = bambu.map(c => [c.fila_type, (c.fila_color_name?.fr || c.fila_color_name?.en || '').trim(), (c.fila_color || []).map(hex).join(','), c.fila_id, c.color_code, c.fila_color_code || '']);
fs.writeFileSync(path.join(OUT, 'bambu.json'), JSON.stringify({source: 'Bambu Studio', colors}));

// Autres marques : un fichier par marque [matière, nom, teintes, poids net g, poids bobine vide g]
const all = await (await fetch(SPOOLMAN)).json();
const byBrand = {};
for (const f of all) {
  if (f.manufacturer === 'Bambu Lab' || Number(f.diameter) !== 1.75) continue;
  const hexes = f.color_hexes?.length ? f.color_hexes.map(hex).join(',') : hex(f.color_hex);
  const row = [f.material, f.name, hexes, Math.round(f.weight || 1000), f.spool_weight ? Math.round(f.spool_weight) : null];
  const list = byBrand[f.manufacturer] ||= [];
  // même couleur en plusieurs conditionnements : on garde la bobine de 1 kg si elle existe
  const same = list.findIndex(r => r[0] === row[0] && r[1] === row[1]);
  if (same < 0) list.push(row); else if (row[3] === 1000) list[same] = row;
}
const index = Object.entries(byBrand).map(([brand, rows]) => {
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  fs.writeFileSync(path.join(OUT, 'm', slug(brand) + '.json'), JSON.stringify(rows));
  return {brand, slug: slug(brand), count: rows.length};
}).sort((a, b) => a.brand.localeCompare(b.brand));
fs.writeFileSync(path.join(OUT, 'marques.json'), JSON.stringify(index));
console.log(`Bambu Lab : ${colors.length} couleurs · autres marques : ${index.length} (${index.reduce((a, b) => a + b.count, 0)} références)`);
