#!/usr/bin/env bash
# ==============================================================================
# BingX Order Scheduler Backend - Automated SSL Certificate & Nginx Setup (Linux)
# ==============================================================================

set -e

echo "================================================================="
echo "   BingX Order Scheduler Backend - Automated SSL Setup Script"
echo "================================================================="

if [ "$EUID" -ne 0 ]; then
  echo "❌ Error: Please run this script as root or with sudo (e.g., sudo ./setup-ssl.sh)"
  exit 1
fi

read -p "Enter your Domain Name or Subdomain (e.g., api.yourdomain.com): " DOMAIN_NAME
read -p "Enter your Email Address (for SSL registration & renewal alerts): " EMAIL_ADDRESS
read -p "Enter local Node.js Backend Port [Default: 8445]: " BACKEND_PORT
BACKEND_PORT=${BACKEND_PORT:-8445}

if [ -z "$DOMAIN_NAME" ] || [ -z "$EMAIL_ADDRESS" ]; then
  echo "❌ Error: Domain Name and Email Address are required!"
  exit 1
fi

echo ""
echo "⚙️ Configured parameters:"
echo "   - Domain: $DOMAIN_NAME"
echo "   - Email: $EMAIL_ADDRESS"
echo "   - Backend Port: $BACKEND_PORT"
echo ""

# 1. Install Nginx and Certbot
echo "📦 Installing Nginx and Certbot..."
if command -v apt-get &> /dev/null; then
    apt-get update
    apt-get install -y nginx certbot python3-certbot-nginx
elif command -v yum &> /dev/null; then
    yum install -y nginx certbot python3-certbot-nginx
elif command -v dnf &> /dev/null; then
    dnf install -y nginx certbot python3-certbot-nginx
else
    echo "⚠️ Package manager not recognized. Please install nginx and certbot manually."
    exit 1
fi

# 2. Configure Nginx Reverse Proxy
echo "🔧 Configuring Nginx reverse proxy..."
NGINX_CONF="/etc/nginx/sites-available/$DOMAIN_NAME"

cat <<EOF > "$NGINX_CONF"
server {
    listen 80;
    server_name $DOMAIN_NAME;

    location / {
        proxy_pass http://127.0.0.1:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # Low latency tuning for WebSocket & High-Precision API
        proxy_buffering off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF

if [ -d "/etc/nginx/sites-enabled" ]; then
    ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$DOMAIN_NAME"
    rm -f /etc/nginx/sites-enabled/default || true
fi

echo "🧪 Testing Nginx configuration..."
nginx -t

echo "🔄 Restarting Nginx service..."
systemctl restart nginx

# 3. Obtain & Configure SSL Certificate via Certbot
echo "🔐 Requesting free Let's Encrypt SSL certificate via Certbot..."
certbot --nginx -d "$DOMAIN_NAME" --non-interactive --agree-tos -m "$EMAIL_ADDRESS" --redirect

echo "🧪 Testing automatic SSL renewal system..."
certbot renew --dry-run

echo ""
echo "================================================================="
echo "🎉 SSL Certificate installed & Nginx Reverse Proxy operational!"
echo "   - HTTPS Base URL: https://$DOMAIN_NAME"
echo "   - WSS WebSocket:  wss://$DOMAIN_NAME"
echo "   - Health Check:   https://$DOMAIN_NAME/health"
echo "================================================================="
