#!/usr/bin/env bash
# ==============================================================================
# BingX Order Scheduler Backend - Ubuntu VM Initial Environment Setup
# ==============================================================================

set -e

echo "================================================================="
echo "   BingX Order Scheduler - Ubuntu VM Setup Engine"
echo "================================================================="

if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Please run this script as root or with sudo (e.g., sudo ./setup-ubuntu-vm.sh)"
  exit 1
fi

echo "🔄 1. Updating Ubuntu package indexes..."
apt-get update -y
apt-get install -y curl git ufw software-properties-common ca-certificates build-essential

echo "📦 2. Installing Node.js 20.x LTS..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "✅ Node.js already installed: $(node -v)"
fi

echo "🚀 3. Installing PM2 Process Manager globally..."
if ! command -v pm2 &> /dev/null; then
    npm install -g pm2
    pm2 startup systemd -u $SUDO_USER --hp /home/$SUDO_USER || true
else
    echo "✅ PM2 already installed: $(pm2 -v)"
fi

echo "🌐 4. Installing Nginx and Certbot..."
apt-get install -y nginx certbot python3-certbot-nginx

echo "🛡️ 5. Setting up UFW Firewall rules..."
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw allow 8445/tcp || true
echo "y" | ufw enable || true

echo "📁 6. Setting up application directory permissions..."
TARGET_DIR="/home/$SUDO_USER/order-schedular-bingx-backend"
mkdir -p "$TARGET_DIR"
chown -R $SUDO_USER:$SUDO_USER "$TARGET_DIR"

echo ""
echo "================================================================="
echo "🎉 Ubuntu VM Environment Ready!"
echo "   - Node.js Version: $(node -v)"
echo "   - NPM Version:    $(npm -v)"
echo "   - PM2 Version:    $(pm2 -v)"
echo "   - Nginx Status:   $(systemctl is-active nginx)"
echo ""
echo "👉 Next Step: Run 'sudo ./setup-ssl-ubuntu.sh' to configure domain & SSL."
echo "================================================================="
