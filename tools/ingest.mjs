#!/usr/bin/env node
/**
 * GHCN-Daily -> L0-dokumentit.
 *
 * Lähde antaa yhden rivin per (asema, päivä, suure). Indeksiin kootaan sen
 * sijaan yksi dokumentti per (asema, päivä), jolloin lämpötila, sade ja lumi
 * ovat saman rivin sarakkeita. Se on sekä pienempi että se muoto jota kysymykset
 * käyttävät: "montako pakkaspäivää" on yksi välikysely, ei kahden liitos.
 */
import { createReadStream } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const DIR = new URL('../data/raw/', import.meta.url);

/** Piste monikulmiossa; maakunta on oikea hallinnollinen jaottelu, ei leveysvyöhyke. */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inFeature(x, y, geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const p of polys) {
    if (!pointInRing(x, y, p[0])) continue;
    if (p.slice(1).some(h => pointInRing(x, y, h))) continue;   // reikä
    return true;
  }
  return false;
}

/** Vuoden 10 päivän jakso, 01..37. Syklinen valitsin kuten kuukausi mutta
 *  kolme kertaa tarkempi, jotta kartan voi sitoa päivämäärään. */
export const jaksoNro = (pvm) => {
  const kk = Math.floor(pvm / 100) % 100, pv = pvm % 100;
  const alkuun = [0, 0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][kk];
  return String(Math.min(36, Math.floor((alkuun + pv - 1) / 10)) + 1).padStart(2, '0');
};

export async function* readObservations() {
  const asemat = JSON.parse(await readFile(new URL('../data/asemat.json', import.meta.url), 'utf8'));
  const mk = JSON.parse(await readFile(new URL('../data/maakuntarajat.json', import.meta.url), 'utf8'));
  for (const [id, a] of Object.entries(asemat)) {
    const f = mk.features.find(f => inFeature(a.lon, a.lat, f.geometry));
    a.maakunta = f ? f.properties.NAMEFIN : null;
  }

  const files = (await readdir(DIR)).filter(f => f.endsWith('.csv.gz')).sort();
  let n = 0;
  for (const file of files) {
    const id = file.slice(0, 11);
    const a = asemat[id];
    if (!a) continue;
    const rl = createInterface({
      input: createReadStream(new URL(file, DIR)).pipe(createGunzip()),
      crlfDelay: Infinity,
    });
    // Rivit tulevat suureittain ryhmiteltyinä, eivät päivittäin, joten koko
    // aseman havainnot kootaan muistiin ennen kuin ne lähtevät eteenpäin.
    const byDay = new Map();
    for await (const line of rl) {
      const f = line.split(',');
      if (f.length < 6) continue;
      const [, pvm, el, raw, , qflag] = f;
      if (qflag) continue;                       // laadunvalvonta hylkäsi arvon
      const v = Number(raw);
      if (!Number.isFinite(v)) continue;
      let d = byDay.get(pvm);
      if (!d) byDay.set(pvm, d = {});
      if (el === 'TMAX') d.tmax = Math.round(v) / 10;        // kymmenesosa-asteet
      else if (el === 'TMIN') d.tmin = Math.round(v) / 10;
      else if (el === 'TAVG') d.tavg = Math.round(v) / 10;
      else if (el === 'PRCP') d.sade = Math.round(v) / 10;   // kymmenesosamillit
      else if (el === 'SNWD') d.lumi = Math.round(v) / 10;   // mm -> cm
    }
    // Vain lämpötila-asemat. Loput 559 ovat sademittareita: ne kolminkertaistaisivat
    // artefaktin (10,4 M riviä ja 743 MB vastaan 4,1 M ja ~295 MB) lisäten vain
    // yhden suureen tiheyttä. Kaikki 19 maakuntaa ja koko 1908-2026 säilyvät silti.
    let lampoa = false;
    for (const d of byDay.values()) if (d.tmax !== undefined) { lampoa = true; break; }
    if (!lampoa) continue;

    for (const [pvm, d] of byDay) {
      const p = Number(pvm);
      if (!Number.isFinite(p) || p < 19000101) continue;
      // Asemanimi, koordinaatit ja korkeus ovat asemakohtaisia, eivät
      // päiväkohtaisia: ne haetaan selaimessa 40 kB:n asemaluettelosta eikä
      // toisteta kymmentä miljoonaa kertaa tallennuslohkoissa. Vuosi on
      // johdettavissa klusterointiavaimesta, joten sekin jää pois.
      //
      // Kuukausi sen sijaan JÄÄ: "kaikki tammikuut" ei ole yhtenäinen väli
      // klusterointiavaimessa vaan hajallaan oleva joukko, ja juuri siksi se
      // kannattaa olla oma bittikarttansa.
      const doc = { id: String(++n), pvm: p, asema: id,
                    kk: String(Math.floor(p / 100) % 100).padStart(2, '0'),
                    jakso: jaksoNro(p) };
      if (a.maakunta) doc.maakunta = a.maakunta;
      for (const k of ['tmax', 'tmin', 'tavg', 'sade', 'lumi'])
        if (d[k] !== undefined) doc[k] = d[k];
      yield doc;
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let n = 0, min = Infinity, max = -Infinity;
  const vuodet = new Map(), maak = new Map();
  for await (const d of readObservations()) {
    n++; min = Math.min(min, d.pvm); max = Math.max(max, d.pvm);
    vuodet.set(d.vuosi, (vuodet.get(d.vuosi) ?? 0) + 1);
    if (d.maakunta) maak.set(d.maakunta, (maak.get(d.maakunta) ?? 0) + 1);
    if (n === 1) console.log('ensimmäinen:', JSON.stringify(d));
  }
  console.log(`${n.toLocaleString('en')} havaintopäivää, ${min} .. ${max}`);
  console.log('vuosia:', vuodet.size, '| maakuntia:', maak.size);
}
