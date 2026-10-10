#!/usr/bin/env node
/**
 * L0-artefakti säähavainnoista.
 *
 * Klusterointiavain on päivä, joten mikä tahansa aikaväli on yhtenäinen
 * bittialue ja vuosihistogrammi on pelkkä jako granuloihin. Kuukausi on
 * erikseen bittikarttana, koska "kaikki tammikuut" on nimenomaan se predikaatti
 * joka EI ole yhtenäinen avaimessa.
 */
import { build } from '../src/build/builder.js';
import { readObservations } from './ingest.mjs';

const out = new URL('../data/' + (process.argv[2] ?? 'saa.l0'), import.meta.url).pathname;

const docs = [];
let n = 0;
for await (const d of readObservations()) {
  docs.push(d);
  if (++n % 2000000 === 0) console.log(`  luettu ${n.toLocaleString('en')}…`);
}
console.log(`sisäänluku valmis: ${docs.length.toLocaleString('en')} dokumenttia`);

const t0 = Date.now();
const { catalog, bytes } = await build({
  docs, index: 'saa', clusteringField: 'pvm', outPath: out,
  indexFields: ['pvm', 'asema', 'maakunta', 'kk', 'jakso', 'tmax', 'tmin', 'tavg', 'sade', 'lumi'],
  // Tallennetut kentät olivat 352 MB eli 44 % artefaktista. Sade ja lumi ovat
  // aggregointisuureita joita ei näytetä riveinä, joten ne jäävät indeksiin
  // mutta pois tallennuslohkoista. Lämpötila jää, koska "kylmin päivä" on
  // luonteva rivikysely.
  storedFields: ['asema', 'pvm', 'tmax', 'tmin'],
  fieldTypes: { asema: 'keyword', maakunta: 'keyword', kk: 'keyword', jakso: 'keyword',
                pvm: 'numeric', tmax: 'numeric', tmin: 'numeric',
                tavg: 'numeric', sade: 'numeric', lumi: 'numeric' },
});
console.log(`\nrakennettu ${(Date.now() - t0) / 1000} s`);
console.log(`  dokumentteja : ${catalog.docCount.toLocaleString('en')}`);
console.log(`  artefakti    : ${(bytes / 1e6).toFixed(1)} MB  (${(bytes / catalog.docCount).toFixed(1)} B/doc)`);
console.log(`  sektioita    : ${Object.keys(catalog.sections).length.toLocaleString('en')}`);
console.log(`  katalogi     : ${(JSON.stringify(catalog).length / 1e6).toFixed(2)} MB`);
console.log(`  aikaväli     : ${catalog.clustering.boundaries[0][0]} .. ${catalog.clustering.boundaries.at(-1)[0]}`);
