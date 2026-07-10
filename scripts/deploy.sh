#!/bin/bash
# Deploy seguro: evita quedar con un build a medias (ej. por disco lleno) que rompe la app.
# - Hace git pull, limpia temporales, verifica espacio.
# - Solo reinicia si el build fue EXITOSO (si falla, se mantiene la versión anterior funcionando).
# Uso en el servidor: bash /opt/agatrack2026/scripts/deploy.sh
set -e
cd /opt/agatrack2026

echo "[deploy] git pull"
git pull

echo "[deploy] limpieza previa de /tmp"
bash scripts/limpiar-tmp-puppeteer.sh || true

USO=$(df / | awk 'NR==2{gsub("%","",$5); print $5}')
echo "[deploy] uso de disco: ${USO}%"
if [ "$USO" -ge 95 ]; then
  echo "[deploy] ❌ ABORTADO: disco al ${USO}%. Libera espacio antes de compilar (no se toca la app en ejecución)."
  exit 1
fi

echo "[deploy] npm run build"
if npm run build; then
  echo "[deploy] ✅ build OK → pm2 restart"
  pm2 restart agatrack --update-env
  echo "[deploy] listo."
else
  echo "[deploy] ❌ BUILD FALLÓ → NO se reinicia. La versión anterior sigue en línea."
  exit 1
fi
