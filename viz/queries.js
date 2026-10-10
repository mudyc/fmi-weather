/**
 * Kaikki sivun kyselyt, yksi rakentaja per avain.
 *
 * Jokainen numero sivulla tulee yhdestä aggregointikyselystä artefaktia vasten,
 * eikä välissä ole palvelinta eikä esilaskettua JSONia. Rakentajat ovat
 * muistiin jääviä, ja hinta kirjataan per kysely: odotus erikseen laskennasta.
 */
export const TALVI = ['12', '01', '02'];
export const KUUKAUDET = ['01','02','03','04','05','06','07','08','09','10','11','12'];
export const KK_NIMI = ['tammi','helmi','maalis','huhti','touko','kesä',
                        'heinä','elo','syys','loka','marras','joulu'];

export function makeQueries(reader) {
  const cache = new Map();
  const costs = [];
  const cat = reader.catalog;

  // Tilastot ovat kuljetuskohtaisia, joten rinnakkaiset mittaukset sotkisivat
  // toisensa. Kyselyt ajetaan peräkkäin; se rinnakkaisuus joka merkitsee on
  // yhden kyselyn sisällä, ei kyselyiden välillä.
  let gate = Promise.resolve();
  const timed = (label, body) => {
    const mine = gate.then(() => run(label, body));
    gate = mine.catch(() => {});
    return mine;
  };
  async function run(label, body) {
    reader.resetStats();
    const t0 = performance.now();
    const res = await reader.search(body);
    const s = reader.transport.stats;
    const ms = performance.now() - t0, io = Math.min(ms, s.fetchMs ?? 0);
    costs.push({ label, ms, io, cpu: Math.max(0, ms - io),
                 rounds: s.rounds, reads: s.reads, bytes: s.bytes, query: body });
    return res;
  }

  const vuodet = (aggs) => ({ v: { histogram: { field: 'pvm', interval: 'year',
                                                min: 1908, max: 2026, ...(aggs ? { aggs } : {}) } } });
  const sarja = (res, key) => res.aggregations.v.buckets
    .map(b => ({ vuosi: b.key, n: b.doc_count, arvo: b[key]?.value ?? null }))
    .filter(x => x.n > 0);

  const B = {
    /** Talviöiden lämpötila vuosittain. Kuukausi on bittikartta, vuosi granulaväli. */
    /**
     * Lämpö ja sade asemittain, ilmastonormaalikaudelta 1991-2020.
     *
     * Kausirajaus on välttämätön eikä koristeellinen: asemat ovat eri ajoilta,
     * ja ilman sitä 1910-1950 toiminut asema näyttäisi kylmemmältä kuin
     * 1991-2026 toiminut. Se olisi lämpenemistä, ei paikkaa.
     */
    async paratiisi() {
      const kausi = { range: { pvm: { gte: 19910101, lte: 20201231 } } };
      const asemittain = sub => ({ a: { terms: { field: 'asema', size: 500 }, aggs: sub } });
      const [kesa, sade] = [
        await timed('kesän päivälämpötila asemittain 1991-2020',
          { query: { bool: { filter: [kausi, { terms: { kk: ['06', '07', '08'] } }] } }, size: 0,
            aggs: asemittain({ t: { avg: { field: 'tmax' } } }) }),
        await timed('sademäärä asemittain 1991-2020',
          { query: { bool: { filter: [kausi, { exists: { field: 'sade' } }] } }, size: 0,
            aggs: asemittain({ s: { avg: { field: 'sade' } } }) }),
      ];
      // Sadepäivät erikseen: millimetrit ja päivät korreloivat vain 0,84, ja ero
      // on systemaattinen. Etelässä sataa harvemmin mutta rajummin, pohjoisessa
      // useammin ja kevyemmin, joten mittarin valinta vaihtaa voittajan.
      const paivat = await timed('sadepäivät (yli 1 mm) asemittain 1991-2020',
        { query: { bool: { filter: [kausi, { range: { sade: { gt: 1 } } }] } }, size: 0,
          aggs: { a: { terms: { field: 'asema', size: 500 } } } });
      const p = Object.fromEntries(paivat.aggregations.a.buckets.map(b => [b.key, b.doc_count]));
      const s = Object.fromEntries(sade.aggregations.a.buckets.map(b => [b.key, { n: b.doc_count, mm: b.s.value }]));
      // Noin kymmenen kesää ja kymmenen vuotta sadetta: vähemmällä yksi
      // poikkeuksellinen vuosi siirtäisi aseman koko kartalla.
      return kesa.aggregations.a.buckets
        .filter(b => b.doc_count >= 900 && (s[b.key]?.n ?? 0) >= 3600)
        .map(b => ({ asema: b.key, kesa: b.t.value,
                     mm: 365 * s[b.key].mm,
                     pv: 365 * (p[b.key] ?? 0) / s[b.key].n,
                     kesia: b.doc_count, mittauksia: s[b.key].n }));
    },

    async talvi() {
      const res = await timed('talviöiden lämpötila vuosittain',
        { query: { terms: { kk: TALVI } }, size: 0, aggs: vuodet({ t: { avg: { field: 'tmin' } } }) });
      return sarja(res, 't');
    },

    /** Kovat pakkaset: osuus kaikista havaintopäivistä, jotta asemamäärän kasvu ei näy trendinä. */
    async pakkaset() {
      const [kylmat, kaikki] = [
        await timed('päivät alle -30 °C vuosittain',
          { query: { range: { tmin: { lt: -30 } } }, size: 0, aggs: vuodet() }),
        await timed('päivät joilla yölämpötila mitattu',
          { query: { exists: { field: 'tmin' } }, size: 0, aggs: vuodet() }),
      ];
      const tot = new Map(sarja(kaikki).map(x => [x.vuosi, x.n]));
      return sarja(kylmat).map(x => ({ vuosi: x.vuosi, n: x.n, kaikki: tot.get(x.vuosi) ?? 0 }))
        .filter(x => x.kaikki > 2000);
    },

    /** Vuodenkierto: yksi kysely kuukautta kohti, kukin yksi kierros. */
    async kierto() {
      const out = [];
      for (const [i, kk] of KUUKAUDET.entries()) {
        const res = await timed(`kuukauden ${kk} lämpötilat`, { query: { term: { kk } }, size: 0,
          aggs: { yo: { stats: { field: 'tmin' } }, paiva: { stats: { field: 'tmax' } } } });
        out.push({ kk, nimi: KK_NIMI[i], n: res.hits.total.value,
                   yo: res.aggregations.yo, paiva: res.aggregations.paiva });
      }
      return out;
    },

    /** Asemakohtainen kartta: yksi kysely, ämpärit asemittain. */
    async asemat() {
      const res = await timed('kovat pakkaset asemittain',
        { query: { range: { tmin: { lt: -30 } } }, size: 0,
          aggs: { a: { terms: { field: 'asema', size: 500 } } } });
      const kaikki = await timed('mittauspäivät asemittain',
        { query: { exists: { field: 'tmin' } }, size: 0,
          aggs: { a: { terms: { field: 'asema', size: 500 } } } });
      const tot = Object.fromEntries(kaikki.aggregations.a.buckets.map(b => [b.key, b.doc_count]));
      return res.aggregations.a.buckets.map(b => ({ asema: b.key, n: b.doc_count, kaikki: tot[b.key] ?? 0 }))
        .filter(x => x.kaikki >= 3000);
    },

    async maakunnat() {
      const res = await timed('talviöiden lämpötila maakunnittain',
        { query: { terms: { kk: TALVI } }, size: 0,
          aggs: { m: { terms: { field: 'maakunta', size: 30 }, aggs: { t: { avg: { field: 'tmin' } } } } } });
      return res.aggregations.m.buckets.map(b => ({ maakunta: b.key, n: b.doc_count, t: b.t.value }))
        .sort((a, b) => a.t - b.t);
    },
  };

  function get(k) { if (!cache.has(k)) cache.set(k, B[k]()); return cache.get(k); }

  return {
    costs,
    meta: { docCount: cat.docCount, sections: Object.keys(cat.sections).length,
            catalogBytes: JSON.stringify(cat).length,
            alku: cat.clustering.boundaries[0][0], loppu: cat.clustering.boundaries.at(-1)[0] },
    has: k => k in B,
    async load(target, keys) {
      await Promise.all(keys.map(async k => { target[k] = await get(k); }));
      return target;
    },
  };
}
