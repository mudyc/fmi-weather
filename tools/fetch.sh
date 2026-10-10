#!/bin/sh
# GHCN-Daily, asemakohtaiset gzip-CSV:t. Yksi tiedosto per asema, 8 rinnakkain.
# Lähde on NOAA:n julkinen hakemisto eikä vaadi avainta.
set -e
cd "$(dirname "$0")/.."
BASE=https://www.ncei.noaa.gov/pub/data/ghcn/daily/by_station
mkdir -p data/raw
n=0
while read -r s; do
  [ -s "data/raw/$s.csv.gz" ] && continue
  curl -sf --max-time 120 -o "data/raw/$s.csv.gz" "$BASE/$s.csv.gz" || echo "ohi: $s" >&2 &
  n=$((n+1))
  [ $((n % 8)) -eq 0 ] && wait
done < data/fi-stations.txt
wait
echo "ladattu $(ls data/raw | wc -l) tiedostoa, $(du -sh data/raw | cut -f1)"
