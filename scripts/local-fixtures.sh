#!/usr/bin/env bash
# Generates the test inputs of docs/local-test.md in api/.local-data/fixtures (git-ignored):
# broken template packages and CSV files. `npm run local:fixtures`. Needs only bash and sed.
set -euo pipefail
cd "$(dirname "$0")/.."
out=api/.local-data/fixtures
ref=docs/templates/minimal
rm -rf "$out"
mkdir -p "$out/templates" "$out/csv"

copy() { mkdir -p "$out/templates/$1"; cp -r "$ref"/. "$out/templates/$1"/; rm -f "$out/templates/$1/golden.png"; }

copy ok-narrow      # valid, but its name box is only 120 pt wide: long names do not fit
sed -i 's/"width": 700/"width": 120/' "$out/templates/ok-narrow/config.json"
copy no-config;     rm "$out/templates/no-config/config.json"
copy bad-json;      echo '{ "engine": ' > "$out/templates/bad-json/config.json"
copy no-font;       rm "$out/templates/no-font/fonts/NotoSans-Regular.ttf"
copy bad-viewbox;   sed -i 's/viewBox="[^"]*"/viewBox="0 0 100 100"/' "$out/templates/bad-viewbox/background.svg"
copy has-script;    sed -i 's#</svg>#<script>alert(1)</script></svg>#' "$out/templates/has-script/background.svg"

hdr='Full name,Email,Subject,Skills,Date'
printf '%s\n' "$hdr" \
  'Aysel Məmmədova,aysel@example.com,Cloud Computing,Cloud; DevOps,2026-05-01' \
  'Elnur Həsənov,,Cloud Computing,,2026-05-01' \
  'Günel Əliyeva,gunel@example.com,Cloud Computing,Linux,' > "$out/csv/valid.csv"
printf '%s\n' "$hdr" \
  'Valid Person,valid@example.com,Cloud Computing,,2026-05-01' \
  ',noname@example.com,Cloud Computing,,2026-05-01' \
  'Bad Email,not-an-email,Cloud Computing,,2026-05-01' \
  'Bad Date,bad@example.com,Cloud Computing,,31/12/2026' \
  "Too Long Subject,long@example.com,$(printf 'x%.0s' $(seq 1 250)),," > "$out/csv/invalid-rows.csv"
printf '%s\n' 'Foo,Bar' 'a,b' > "$out/csv/wrong-headers.csv"
{ echo "$hdr"; for i in $(seq 1 1200); do echo "Bulk Person $i,bulk$i@example.com,Load test,,2026-05-01"; done; } > "$out/csv/bulk-1200.csv"
echo "Fixtures written to $out"
