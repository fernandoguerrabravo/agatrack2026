#!/bin/bash
# Mantenimiento proactivo de /tmp para evitar que el disco se llene con perfiles de Puppeteer/Chromium.
# - Corre cada 15 min (cron).
# - Normal: borra perfiles y temporales de más de 60 min.
# - Si el disco supera el umbral (85%): limpieza agresiva (perfiles de más de 5 min).
# Cron: */15 * * * * /opt/agatrack2026/scripts/limpiar-tmp-puppeteer.sh >> /var/log/agatrack-limpieza-tmp.log 2>&1

SNAP_TMP="/tmp/snap-private-tmp/snap.chromium/tmp"
USO=$(df / | awk 'NR==2{gsub("%","",$5); print $5}')
STAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ "$USO" -ge 85 ]; then
  EDAD=5
  MODO="AGRESIVO (disco ${USO}%)"
else
  EDAD=60
  MODO="normal (disco ${USO}%)"
fi

# Perfiles de Puppeteer en el tmp confinado del snap chromium
find "$SNAP_TMP" -maxdepth 1 -name 'puppeteer_dev_chrome_profile-*' -type d -mmin +$EDAD -exec rm -rf {} + 2>/dev/null
# Temporales sueltos en /tmp raíz (uploads, conversiones PDF->PNG, perfiles)
find /tmp -maxdepth 1 \( -name 'upload_*' -o -name 'cl_*' -o -name 'puppeteer_dev_chrome_profile-*' \) -mmin +$EDAD -exec rm -rf {} + 2>/dev/null

USO_FIN=$(df / | awk 'NR==2{print $5}')
echo "[$STAMP] limpieza $MODO edad>${EDAD}min → uso final $USO_FIN"
