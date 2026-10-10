#!/bin/sh
# Lataa jokainen kuvaaja headless-selaimessa ja tarkistaa kaksi asiaa:
# ettei konsoliin tule virhettä ja että svg:hen tuli piirrettyä sisältöä.
#
# Tämä on olemassa koska yksi kuvaaja ehti tuotantoon rikkinäisenä: sen kysely
# käytti ylätason stats-aggregointia, jota indeksi ei tue, ja testasin silloin
# vain osan kuvaajista. Virheen näki vasta käyttäjä.
#
#   tools/smoke.sh [portti]
set -e
cd "$(dirname "$0")/.."
PORT=${1:-8899}
CHROME=${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}
[ -x "$CHROME" ] || { echo "Chromea ei löydy: $CHROME (aseta CHROME=)" >&2; exit 1; }

node tools/serve.js . "$PORT" >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
i=0; while [ $i -lt 40 ] && ! curl -sf -o /dev/null "http://127.0.0.1:$PORT/viz/index.html"; do i=$((i+1)); done

CHARTS=$(grep -o "reg('[a-z-]*'" viz/index.html | sed "s/reg('//;s/'//")
fail=0
for c in $CHARTS; do
  out=$(mktemp); err=$(mktemp)
  "$CHROME" --headless --disable-gpu --no-sandbox --enable-logging=stderr --v=0 \
    --virtual-time-budget=180000 --dump-dom \
    "http://127.0.0.1:$PORT/viz/index.html?chart=$c" >"$out" 2>"$err"
  msg=$(grep -E "CONSOLE.*(Uncaught|Error)" "$err" | head -1 | sed 's/.*CONSOLE[^"]*"//;s/".*//')
  # <line> mukaan: osa kuvaajista piirtää alueet path-elementteinä ja loput viivoina
  n=$(grep -o "<path\|<rect\|<circle\|<line" "$out" | wc -l | tr -d ' ')
  if [ -n "$msg" ]; then printf '  %-14s VIRHE  %s\n' "$c" "$msg"; fail=1
  elif [ "$n" -lt 10 ]; then printf '  %-14s TYHJÄ  vain %s elementtiä\n' "$c" "$n"; fail=1
  else printf '  %-14s ok     %s elementtiä\n' "$c" "$n"; fi
  rm -f "$out" "$err"
done
[ $fail -eq 0 ] && echo "kaikki kuvaajat kunnossa" || { echo "KORJATTAVAA"; exit 1; }
