#!/bin/sh
# FMI:n päivittäinen lumensyvyys koko maasta. bbox kattaa kaikki asemat kerralla
# ja aikaraja on noin vuosi per pyyntö, joten koko historia on ~35 pyyntöä.
set -e
cd "$(dirname "$0")/.."
mkdir -p data/fmi
B="https://opendata.fmi.fi/wfs?service=WFS&version=2.0.0&request=GetFeature"
Q="storedquery_id=fmi::observations::weather::daily::simple&bbox=19,59,32,71&parameters=snow"
for y in $(seq 1990 2026); do
  f="data/fmi/snow-$y.xml.gz"
  [ -s "$f" ] && continue
  curl -sf --max-time 600 "$B&$Q&starttime=$y-01-01T00:00:00Z&endtime=$y-12-31T00:00:00Z" \
    | gzip > "$f" || { echo "ohi: $y" >&2; rm -f "$f"; }
  echo "$y $(du -h "$f" 2>/dev/null | cut -f1)"
done
echo "valmis: $(ls data/fmi | wc -l) vuotta, $(du -sh data/fmi | cut -f1)"
