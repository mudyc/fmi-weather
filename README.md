# Suomen säähavainnot L0-indeksinä

363 havaintoasemaa, **4 126 558 asemapäivää vuosilta 1908–2026**, yhtenä
muuttumattomana tiedostona jota selain kyselee suoraan HTTP Range -pyynnöillä.
Ei hakupalvelinta, ei esilaskettuja JSONeja.

Tämä on kolmas esimerkki [serverless_index](https://github.com/mudyc/serverless_index)-
formaatista. Kaksi ensimmäistä näyttivät muut puolet:

| esimerkki | mitä se näyttää |
| --- | --- |
| [mml-kartta](https://github.com/mudyc/mml-kartta) | Hilbert-avain ja geometria — tila |
| [ajoneuvorekisteri](https://github.com/mudyc/ajoneuvorekisteri) | numeeriset sarakkeet ja aggregoinnit |
| **tämä** | **klusterointiavain aikana** |

## Miksi aika on kiinnostava avain

Klusterointiavain on havaintopäivä, joten mikä tahansa aikaväli on **yhtenäinen
bittialue** ja vuosihistogrammi on pelkkä jako granuloihin — ei lajittelua, ei
koetinta.

Kuukausi on erikseen omana bittikarttanaan, ja se on tämän aineiston opetus:
*“kaikki tammikuut” ei ole yhtenäinen väli avaimessa* vaan 118 erillistä pätkää.
Juuri siksi se kannattaa olla bittikartta eikä välihaku. Talvikysely on siis
bittikartta (kuukausi) × yhtenäinen bittialue (vuodet) × sarakeluku (lämpötila),
kaikki samassa aallossa.

## Mitä aineistosta näkyy

| vuosikymmen | talviöiden lämpötila | kovia pakkasia (< −30 °C) |
| --- | ---: | ---: |
| 1960-luku | −13,0 °C | 15,1 ‰ |
| 1980-luku | −13,6 °C | 17,8 ‰ |
| 1990-luku | −10,0 °C | 7,4 ‰ |
| 2020-luku | **−9,6 °C** | **5,7 ‰** |

**+3,4 astetta ja pakkaspäivät kolmannekseen.** 1980-luku erottuu kylmänä
poikkeamana ja muutos tapahtuu 1990-luvulla.

## Koko ja hinta

| | |
| --- | ---: |
| artefakti | 389 MB, 9 osaa à 45 MiB |
| katalogi (residentti) | 4,6 MB |
| indeksiosioita | 415 |
| rakennusaika | **14,5 s** |
| tyypillinen kuvaaja | 1–2 kierrosta, 10–20 ms |

Rakennus on sekunteja eikä tunteja, koska avainsanojen kardinaliteetti on pieni:
363 asemaa, 19 maakuntaa, 12 kuukautta. Ajoneuvorekisterin 96 521 mallinimeä vei
4 h 41 min — katalogi skaalautuu kardinaliteetin, ei korpuksen mukaan.

Artefakti mahtuu GitHub Pagesin rajoihin: alle 100 MiB per tiedosto ja alle 1 GB
sivustoa. `ChunkedHttpTransport` kokoaa osat takaisin tavualueita tarjoiltaessa,
eikä lukija tiedä niistä mitään.

## Ajaminen

```bash
node tools/fetch.sh              # GHCN-asemat -> data/raw/   (922 tiedostoa, 73 MB)
node tools/build.mjs             # -> data/saa.l0             (389 MB, 14,5 s)
node tools/split-artifact.js data/saa.l0
node tools/serve.js . 8080       # mikä tahansa Rangea tukeva palvelin kelpaa
open http://127.0.0.1:8080/viz/

tools/smoke.sh                   # lataa jokaisen kuvaajan ja tarkistaa että se piirtyy
```

## Rakenne

| | |
| --- | --- |
| `viz/` | sivu ja sen kyselyt (`queries.js`) |
| `tools/` | haku, sisäänluku, artefaktin rakennus ja pilkkominen |
| `src/` | L0:n ydin — **kopio** serverless_index-projektista |
| `data/` | artefaktit ja raakadata, **ei versionhallinnassa** |

## Aineistosta

Lähde on **GHCN-Daily** (NOAA), jonka Suomen osuus on Ilmatieteen laitoksen
havaintoja. Mitattu kattavuus:

| suure | asemia | vuodet |
| --- | ---: | --- |
| sademäärä | 835 | 1908–2026 |
| ylin ja alin lämpötila | 363 | 1908–2026 |
| lumen syvyys | 30 | 1973–2026 |

Indeksiin otettiin **vain lämpötila-asemat**. Loput 559 ovat sademittareita, ja
ne olisivat kolminkertaistaneet artefaktin (10,4 M riviä ja 743 MB vastaan 4,1 M
ja 389 MB) lisäten vain yhden suureen tiheyttä. Kaikki 19 maakuntaa ja koko
1908–2026 säilyvät silti.

Kaksi asiaa jotka kannattaa tietää lukuja katsoessa:

**Asemaverkko on kasvanut.** Siksi kovat pakkaset esitetään osuutena
havaintopäivistä eikä kappalemääränä — kappalemäärä näyttäisi trendin joka on
asemien lukumäärää eikä säätä. Ennen 1950-lukua asemia on niin vähän että käyrät
heiluvat otoskoon takia.

**Maakuntavertailu sekoittaa vuosikymmeniä.** Koko aineiston yli laskettu
keskiarvo näyttää kylmemmältä siellä missä asemat ovat vanhoja. Se on
maantiedettä, ei nykyilmastoa.

**Pilvisyys ja auringonpaiste puuttuvat.** GHCN:ssä niitä ei ole suomalaisilla
asemilla lainkaan. Ilmatieteen laitoksen avoimessa datassa pilvisyys on
(`n_man`, 0–8 oktaa) mutta vain 10 minuutin havaintoina: 111 asemaa, 36 MB XML
per vuorokausi, eli koko maan historia olisi ~11 000 pyyntöä ja satoja
gigatavuja. Lumen syvyys sen sijaan on FMI:ltä halpa — bbox kattaa koko maan ja
aikaraja on noin vuosi per pyyntö.

## Lisenssit

| | |
| --- | --- |
| koodi | MIT — [`LICENSE`](LICENSE) |
| havaintoaineistot | [`data/LICENSE`](data/LICENSE) |
