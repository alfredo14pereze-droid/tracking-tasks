#!/bin/sh
# Pone el mismo ?v=<N> en todos los imports de v2 y en index.html, para que el navegador
# no mezcle archivos viejos (caché de GitHub Pages: 10 min) con nuevos después de publicar.
# Uso: sh v2/bump-version.sh        (desde la raíz del repo, antes de cada commit de v2)
set -e
cd "$(dirname "$0")"
V=$(date +%Y%m%d%H%M)
# imports relativos: from './x.js' o from './x.js?v=…'
find js -name '*.js' -exec sed -i '' -E "s#(from '\.{1,2}/[^'?]+\.js)(\?v=[0-9]+)?'#\1?v=$V'#g" {} +
sed -i '' -E "s#(css/theme\.css|js/app\.js)(\?v=[0-9]+)?\"#\1?v=$V\"#g" index.html
echo "versión $V"
