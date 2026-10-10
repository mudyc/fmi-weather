#!/usr/bin/env node
/**
 * FMI:n WFS-vastaus -> lumihavainnot.
 *
 * Asemaa ei yksilöi nimi vaan koordinaatti, ja arvo -1 tarkoittaa paljasta
 * maata eikä puuttuvaa havaintoa. NaN on puuttuva.
 */
import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const DIR = new URL('../data/fmi/', import.meta.url);

/** Vuoden 10 päivän jakso, 01..37. Syklinen valitsin kuten kuukausi mutta
 *  kolme kertaa tarkempi, jotta kartan voi sitoa päivämäärään. */
export const jaksoNro = (pvm) => {
  const kk = Math.floor(pvm / 100) % 100, pv = pvm % 100;
  const alkuun = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][kk];
  return String(Math.min(36, Math.floor((alkuun + pv - 1) / 10)) + 1).padStart(2, '0');
};

export async function* readSnow() {
  const files = (await readdir(DIR)).filter(f => f.endsWith('.xml.gz')).sort();
  for (const f of files) {
    const rl = createInterface({
      input: createReadStream(new URL(f, DIR)).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    let pos = null, aika = null;
    for await (const line of rl) {
      let m = line.match(/<gml:pos>([\d.]+)\s+([\d.]+)/);
      if (m) { pos = [+m[1], +m[2]]; continue; }
      m = line.match(/<BsWfs:Time>(\d{4})-(\d{2})-(\d{2})/);
      if (m) { aika = +(m[1] + m[2] + m[3]); continue; }
      m = line.match(/<BsWfs:ParameterValue>(-?[\d.]+|NaN)/);
      if (m && pos && aika) {
        const v = Number(m[1]);
        if (Number.isFinite(v)) yield { lat: pos[0], lon: pos[1], pvm: aika, lumi: v < 0 ? 0 : v };
        pos = null; aika = null;
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const asemat = new Map();
  let n = 0, lumisia = 0, min = Infinity, max = -Infinity, syvin = 0;
  for await (const d of readSnow()) {
    n++;
    const k = d.lat.toFixed(4) + ',' + d.lon.toFixed(4);
    const a = asemat.get(k) ?? { n: 0, lat: d.lat, lon: d.lon, max: 0 };
    a.n++; if (d.lumi > a.max) a.max = d.lumi;
    asemat.set(k, a);
    if (d.lumi > 0) lumisia++;
    if (d.lumi > syvin) syvin = d.lumi;
    min = Math.min(min, d.pvm); max = Math.max(max, d.pvm);
  }
  console.log(`${n.toLocaleString('en')} havaintoa, ${asemat.size} asemaa, ${min} .. ${max}`);
  console.log(`lumisia päiviä ${lumisia.toLocaleString('en')} (${(100*lumisia/n).toFixed(0)} %), syvin ${syvin} cm`);
  const lat = [...asemat.values()].map(a => a.lat);
  console.log(`leveysasteet ${Math.min(...lat).toFixed(2)} .. ${Math.max(...lat).toFixed(2)}`);
}
