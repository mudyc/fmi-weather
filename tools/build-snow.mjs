#!/usr/bin/env node
/**
 * Lumiartefakti FMI:n havainnoista.
 *
 * Oma artefaktinsa eikä osa lämpötila-aineistoa, koska asemat ovat eri:
 * GHCN tuntee ne tunnuksella, FMI vain koordinaatilla, ja jakso on 1990-2026
 * eikä 1908-2026. Yhdistäminen olisi vaatinut nimien arvaamista.
 *
 * Leveysvyöhyke on oma bittikarttansa, jotta "pohjoisesta etelään" on yksi
 * kysely vyöhykettä kohti eikä yksi asemaa kohti.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { build } from '../src/build/builder.js';
import { readSnow } from './parse-snow.mjs';

const out = new URL('../data/lumi.l0', import.meta.url).pathname;

// Asemien nimet FMI:n asemaluettelosta, täsmäytys koordinaatilla.
const st = readFileSync(new URL('../data/fmi-asemat.xml', import.meta.url), 'utf8');
const nimet = [...st.matchAll(/<gml:name codeSpace="http:\/\/xml\.fmi\.fi\/namespace\/locationcode\/name">([^<]+)/g)].map(m => m[1]);
const sijainnit = [...st.matchAll(/<gml:pos>([\d.]+) ([\d.]+)/g)].map(m => [+m[1], +m[2]]);
const luettelo = nimet.map((n, i) => ({ nimi: n, lat: sijainnit[i]?.[0], lon: sijainnit[i]?.[1] }))
                      .filter(x => x.lat != null);
const nimeä = (lat, lon) => {
  let paras = null, d = Infinity;
  for (const s of luettelo) {
    const e = (s.lat - lat) ** 2 + (s.lon - lon) ** 2;
    if (e < d) { d = e; paras = s; }
  }
  return d < 1e-5 ? paras.nimi : null;        // ~0,3 km
};

const mk = JSON.parse(readFileSync(new URL('../data/maakuntarajat.json', import.meta.url), 'utf8'));
const rengas = (x, y, r) => { let s = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) s = !s;
  } return s; };
const maakunta = (lon, lat) => {
  for (const f of mk.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const p of polys) if (rengas(lon, lat, p[0]) && !p.slice(1).some(h => rengas(lon, lat, h)))
      return f.properties.NAMEFIN;
  }
  return null;
};

const asemat = {};
const docs = [];
let n = 0;
for await (const d of readSnow()) {
  const id = d.lat.toFixed(4) + '_' + d.lon.toFixed(4);
  if (!asemat[id]) asemat[id] = { lat: d.lat, lon: d.lon, nimi: nimeä(d.lat, d.lon) ?? `${d.lat.toFixed(2)}°N ${d.lon.toFixed(2)}°E`,
                                  maakunta: maakunta(d.lon, d.lat), n: 0 };
  asemat[id].n++;
  docs.push({ id: String(++n), pvm: d.pvm, asema: id, lumi: d.lumi,
              kk: String(Math.floor(d.pvm / 100) % 100).padStart(2, '0'),
              // Yhden asteen vyöhyke: "6061" = 60-61°N. Lajittuu merkkijonona.
              vyohyke: String(Math.floor(d.lat)) + String(Math.floor(d.lat) + 1),
              ...(asemat[id].maakunta ? { maakunta: asemat[id].maakunta } : {}) });
}
console.log(`${docs.length.toLocaleString('en')} havaintoa, ${Object.keys(asemat).length} asemaa`);
console.log(`nimettyjä: ${Object.values(asemat).filter(a => !a.nimi.includes('°N')).length}`);
writeFileSync(new URL('../viz/lumiasemat.json', import.meta.url), JSON.stringify(asemat));

const t0 = Date.now();
const { catalog, bytes } = await build({
  docs, index: 'lumi', clusteringField: 'pvm', outPath: out,
  indexFields: ['pvm', 'asema', 'vyohyke', 'kk', 'maakunta', 'lumi'],
  storedFields: ['asema', 'pvm', 'lumi'],
  fieldTypes: { asema: 'keyword', vyohyke: 'keyword', kk: 'keyword',
                maakunta: 'keyword', pvm: 'numeric', lumi: 'numeric' },
});
console.log(`\nrakennettu ${(Date.now() - t0) / 1000} s`);
console.log(`  artefakti ${(bytes / 1e6).toFixed(1)} MB (${(bytes / catalog.docCount).toFixed(1)} B/doc)`);
console.log(`  sektioita ${Object.keys(catalog.sections).length}, katalogi ${(JSON.stringify(catalog).length / 1e6).toFixed(2)} MB`);
