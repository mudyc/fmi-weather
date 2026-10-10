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

/** Lumikauden kuukaudet järjestyksessä: syksystä kesään, jolloin talvi on yhtenä kaarena. */
/** Hiihtokauden kuukaudet ja niiden pituudet. */
/**
 * Kaksi lajia, sama koneisto. Rajat ovat valittuja eivätkä luonnonvakioita,
 * ja ne on siksi kirjoitettu yhteen paikkaan näkyviin.
 */
export const LAJIT = {
  hiihto: {
    nimi: 'hiihto', vari: '--s1',
    lumiNimi: 'lunta yli 20 cm', lumiEhto: [{ range: { lumi: { gte: 20 } } }],
    lampoNimi: 'hiihtokeli −20…0 °C',
    lampoEhto: [{ range: { tmin: { gte: -20 } } }, { range: { tmax: { lte: 0 } } }],
    valoTarve: [2, 6],                       // alle 2 h ei lainkaan, 6 h täysi
    kuvaus: 'lunta yli 20 cm, −20…0 °C, valoa vähintään kuusi tuntia',
  },
  juoksu: {
    nimi: 'polkujuoksu', vari: '--s2',
    lumiNimi: 'maa sula', lumiEhto: [{ range: { lumi: { lt: 1 } } }],
    lampoNimi: 'juoksukeli 10…15 °C',
    lampoEhto: [{ range: { tmax: { gte: 10, lte: 15 } } }],
    valoTarve: [5, 10],
    kuvaus: 'maa sula, päivän ylin 10…15 °C, valoa vähintään kymmenen tuntia',
  },
};

export const HIIHTOKK = ['11', '12', '01', '02', '03', '04'];

export const LUMIKAUSI = ['09','10','11','12','01','02','03','04','05','06','07','08'];

export function makeQueries(reader, avaaLumi) {
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
  /** Lumi on oma artefaktinsa; avataan vasta kun sitä tarvitaan. */
  let lumiP = null;
  const lumiReader = () => (lumiP ??= avaaLumi());
  async function timedOn(rd, label, body) {
    const mine = gate.then(() => runOn(rd, label, body));
    gate = mine.catch(() => {});
    return mine;
  }
  async function runOn(rd, label, body) {
    rd.resetStats();
    const t0 = performance.now();
    const res = await rd.search(body);
    const s = rd.transport.stats;
    const ms = performance.now() - t0, io = Math.min(ms, s.fetchMs ?? 0);
    costs.push({ label, ms, io, cpu: Math.max(0, ms - io),
                 rounds: s.rounds, reads: s.reads, bytes: s.bytes, query: body });
    return res;
  }

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
     * Lumen syvyys leveysvyöhykkeittäin, vuosi-kuukausi-tarkkuudella.
     *
     * Yksi kysely vyöhykettä kohti riittää koko matriisiin, koska histogramin
     * numeerinen väli 100 pilkkoo klusterointiavaimen YYYYMMDD muotoon
     * YYYYMM00 — eli vuosi-kuukausi-ämpäreihin. Ilman sitä tarvittaisiin
     * kysely jokaista vuoden ja kuukauden paria kohti.
     */
    async lumiVyohykkeet() {
      const lumi = await lumiReader();
      const vyohykkeet = Object.keys(lumi.catalog.fields.vyohyke.values).sort().reverse();  // pohjoisin ensin
      const out = [];
      for (const v of vyohykkeet) {
        const res = await timedOn(lumi, `lumen syvyys ${v.slice(0, 2)}-${v.slice(2)}°N`,
          { query: { term: { vyohyke: v } }, size: 0,
            aggs: { v: { histogram: { field: 'pvm', interval: 100, aggs: { s: { avg: { field: 'lumi' } } } } } } });
        const solut = res.aggregations.v.buckets
          .filter(b => b.doc_count >= 20)
          .map(b => ({ vuosi: Math.floor(b.key / 10000), kk: String(Math.floor(b.key / 100) % 100).padStart(2, '0'),
                       cm: b.s.value, n: b.doc_count }));
        if (solut.length) out.push({ vyohyke: v, etela: +v.slice(0, 2), solut });
      }
      return out;
    },

    /**
     * Olosuhteet yhdessä kymmenen päivän jaksossa, asemittain.
     *
     * Jakso on oma bittikarttansa, joten kartan voi sitoa päivämäärään ilman
     * että kyselyn muoto muuttuu. Vain valittu jakso ajetaan, ja ajettu jää
     * muistiin — osiot ovat muuttumattomia eikä välimuisti voi vanhentua.
     *
     * Lumi ja lämpötila ovat eri artefakteissa ja eri asemilla; liitos tehdään
     * selaimessa koordinaattien perusteella.
     */
    async olot(laji, jakso) {
      const K = LAJIT[laji];
      const lumi = await lumiReader();
      const kausi = { range: { pvm: { gte: 19910101 } } };
      const AS = { a: { terms: { field: 'asema', size: 1000 } } };
      const osuus = async (rd, nimi, pohja, ehto) => {
        const [n, o] = [
          await timedOn(rd, `${nimi}, jakso ${jakso}: kaikki`,
            { query: { bool: { filter: [kausi, { term: { jakso } }, ...pohja] } }, size: 0, aggs: AS }),
          await timedOn(rd, `${nimi}, jakso ${jakso}: ehto täyttyy`,
            { query: { bool: { filter: [kausi, { term: { jakso } }, ...ehto] } }, size: 0, aggs: AS }),
        ];
        const N = Object.fromEntries(n.aggregations.a.buckets.map(b => [b.key, b.doc_count]));
        const O = Object.fromEntries(o.aggregations.a.buckets.map(b => [b.key, b.doc_count]));
        // Alle viiden vuoden havainnot pois: yksi poikkeusvuosi heittäisi osuuden.
        return Object.fromEntries(Object.entries(N).filter(([, v]) => v >= 50)
          .map(([k, v]) => [k, (O[k] ?? 0) / v]));
      };
      return {
        lumi: await osuus(lumi, K.lumiNimi, [{ exists: { field: 'lumi' } }], K.lumiEhto),
        lampo: await osuus(reader, K.lampoNimi, [{ exists: { field: 'tmax' } }], K.lampoEhto),
      };
    },

    /**
     * Karhunkierros: neljän aseman toukokuu, päivätarkkuudella.
     *
     * Tämä on sivun ainoa kysely joka hakee dokumentteja eikä ämpäreitä.
     * Aggregointi ei kelpaisi, koska kysymys on päiväkohtainen
     * todennäköisyys eikä keskiarvo.
     *
     * Kiutaköngäs on reitin varrella laaksossa. Värriötunturi on aineiston
     * ainoa tunturiasema jolla on sama 37 vuoden jakso, ja Naruska ja
     * Kelloselkä ovat lähes yhtä pohjoisessa mutta alavalla maalla — ne ovat
     * mukana siksi, että ilman niitä tunturin ja laakson ero selittyisi yhtä
     * hyvin leveysasteella kuin korkeudella.
     *
     * Kesäkuu jäi pois: kuvaaja piirtää vain toukokuun, ja neljä asemaa
     * kahdelta kuukaudelta olisi ollut nelinkertainen nouto turhaan.
     */
    async karhunkierros() {
      const lumi = await lumiReader();
      const ASEMAT = { '66.3700_29.3119': 'Kiutaköngäs',        // Oulanka, laakso
                       '67.7486_29.6113': 'Värriötunturi',      // tunturi
                       '67.1623_29.1777': 'Salla Naruska',      // alava, lähes yhtä pohjoinen
                       '66.9444_28.9769': 'Salla Kelloselkä' }; // alava
      const res = await timedOn(lumi, 'Neljä asemaa, toukokuu',
        { query: { bool: { filter: [{ terms: { asema: Object.keys(ASEMAT) } },
                                    { term: { kk: '05' } }] } },
          size: 5000, sort: [{ pvm: 'asc' }] });
      return res.hits.hits.map(h => h._source)
        .map(d => ({ asema: ASEMAT[d.asema], vuosi: Math.floor(d.pvm / 10000),
                     kk: Math.floor(d.pvm / 100) % 100, pv: d.pvm % 100, cm: d.lumi }));
    },

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

    /**
     * Vuodenkierto: kaikki kaksitoista kuukautta YHDELLÄ kyselyllä.
     *
     * Numeeriset tilastot ovat alaämpäreitä, eivät ylätason aggregointeja —
     * ylätasolla indeksi tuntee vain `terms`in ja `histogram`in. Kuukausi on
     * jo oma bittikarttansa, joten terms(kk) antaa kaikki kaksitoista ämpäriä
     * kerralla eikä kuukausikohtaista suodatinta tarvita lainkaan.
     */
    async kierto() {
      const res = await timed('kuukausien lämpötilat', { size: 0,
        aggs: { kk: { terms: { field: 'kk', size: 12 },
                      aggs: { yo: { stats: { field: 'tmin' } },
                              paiva: { stats: { field: 'tmax' } } } } } });
      return res.aggregations.kk.buckets
        .map(b => ({ kk: b.key, nimi: KK_NIMI[+b.key - 1], n: b.doc_count, yo: b.yo, paiva: b.paiva }))
        .sort((a, b) => a.kk.localeCompare(b.kk));
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
    /** Jaksokohtainen haku kutsutaan suoraan, koska avain riippuu valinnasta. */
    olot: (laji, jakso) => B.olot(laji, jakso),
    async load(target, keys) {
      await Promise.all(keys.map(async k => { target[k] = await get(k); }));
      return target;
    },
  };
}
