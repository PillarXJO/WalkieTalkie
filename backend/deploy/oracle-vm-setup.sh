#!/usr/bin/env bash
# Oracle Cloud "Always Free" Ubuntu VM bootstrap for the PTT backend.
#
# Run on the VM (after cloning the repo):
#   sudo bash backend/deploy/oracle-vm-setup.sh
#
# It installs Docker, opens the local firewall for HTTP/HTTPS, and prints the
# remaining manual steps (VCN ingress rules, DuckDNS, .env, compose up).

set -euo pipefail

echo "==> Checking root..."
if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo:  sudo bash backend/deploy/oracle-vm-setup.sh"
  exit 1
fi

echo ">>> Installing Docker (works on ARM64 and x86_64)..."
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo ">>> Opening firewall ports 80/443 (Oracle Ubuntu images ship closed)..."
if command -v iptables >/dev/null 2>&1; then
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || \
    iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
  if ! dpkg -s iptables-persistent >/dev/null 2>&1; then
    echo "iptables-persistent iptables-persistent/autosave_v4 boolean true" | debconf-set-selections
    echo "iptables-persistent iptables-persistent/autosave_v6 boolean true" | debconf-set-selections
    DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null 2>&1 || true
  fi
  netfilter-persistent save >/dev/null 2>&1 || true
fi

echo ""
echo "============================== DONE =============================="
echo "Remaining steps (see the deployment guide):"
echo "  1. Oracle console -> VCN -> Security List -> add Ingress rules"
echo "     TCP 80 and TCP 443, source 0.0.0.0/0."
echo "  2. Create a free subdomain at https://www.duckdns.org and point it"
echo "     at this VM's public IP."
echo "  3. cd backend && cp .env.production.example .env  and edit:"
echo "       DOMAIN=<yourname>.duckdns.org"
echo "       POSTGRES_PASSWORD / DATABASE_URL (same password)"
echo "       JWT_ACCESS_SECRET / JWT_REFRESH_SECRET  (openssl rand -base64 48)"
echo "       CORS_ORIGINS=*   ALLOW_INSECURE_CORS=true"
echo "       WEB_BASE_URL / INVITE_BASE_URL = https://<yourname>.duckdns.org"
echo "  4. docker compose -f docker-compose.prod.yml up -d --build"
echo "  5. curl https://<yourname>.duckdns.org/healthz"
echo "=================================================================="
