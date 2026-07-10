#!/bin/bash
# Limpia perfiles de Puppeteer/Chromium y temporales viejos (>60 min) para evitar llenar el disco.
# Puppeteer/Chromium (snap) deja perfiles ~128MB en /tmp que no siempre se limpian al cerrar.
# Cron sugerido: 15 * * * * /opt/agatrack2026/scripts/limpiar-tmp-puppeteer.sh >> /var/log/agatrack-limpieza-tmp.log 2>&1
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] limpieza /tmp iniciada"
find /tmp/snap-private-tmp/snap.chromium/tmp -maxdepth 1 -name 'puppeteer_dev_chrome_profile-*' -type d -mmin +60 -exec rm -rf {} + 2>/dev/null
find /tmp -maxdepth 1 \( -name 'upload_*' -o -name 'cl_*' -o -name 'puppeteer_dev_chrome_profile-*' \) -mmin +60 -exec rm -rf {} + 2>/dev/null
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] limpieza /tmp completada. Uso disco: $(df -h / | awk 'NR==2{print $5}')"
