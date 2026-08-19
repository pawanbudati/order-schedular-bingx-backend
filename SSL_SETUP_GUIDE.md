# 🔐 Automated SSL Certificate & Nginx Proxy Setup Guide

This guide explains how to set up a free **Let's Encrypt SSL Certificate** with **Nginx Reverse Proxy** on your AWS VM (Ubuntu/Debian/Amazon Linux) for the BingX Order Scheduler Backend.

---

## 📋 Prerequisites

1. **AWS EC2 Security Group Rules**:
   Ensure inbound rules permit:
   - **Port 80 (HTTP)**: `0.0.0.0/0` (Required for SSL validation & HTTP->HTTPS redirect)
   - **Port 443 (HTTPS)**: `0.0.0.0/0` (Required for SSL traffic)
   - **Port 22 (SSH)**: `0.0.0.0/0` or your IP

2. **DNS A-Record**:
   Point your domain or subdomain (e.g. `api.yourdomain.com`) to your AWS EC2 Public IP address.

---

## ⚡ Option 1: 1-Click Automated Script (Recommended for Linux/Ubuntu)

Run the automated script included in `scripts/setup-ssl.sh` directly on your AWS VM:

```bash
# 1. Navigate to backend project scripts directory
cd ~/order-schedular-bingx-backend/scripts

# 2. Make script executable
chmod +x setup-ssl.sh

# 3. Run script with sudo
sudo ./setup-ssl.sh
```

### What the script automatically does:
1. Installs **Nginx**, **Certbot**, and `python3-certbot-nginx`.
2. Generates an Nginx Reverse Proxy server block forwarding HTTPS traffic on port 443 to `http://127.0.0.1:8445` (with WebSocket & low-latency headers).
3. Obtains free Let's Encrypt SSL certificate & enables auto-renewal.
4. Configures HTTP -> HTTPS auto-redirection.

---

## 🪟 Option 2: 1-Click Automated Script for Windows Server VM

If your AWS VM runs **Windows Server**:

```powershell
# Run PowerShell as Administrator
cd C:\path\to\order-schedular-bingx-backend\scripts
.\setup-ssl.ps1
```

---

## 🌐 Updating Frontend Connection Settings

Once SSL is active on your domain (`api.yourdomain.com`):

- **HTTPS API Endpoint**: `https://api.yourdomain.com/api`
- **WSS WebSocket Endpoint**: `wss://api.yourdomain.com`

---

## 🔄 SSL Certificate Auto-Renewal Verification

Certbot sets up a systemd timer / cron job automatically. You can test renewal anytime via:

```bash
sudo certbot renew --dry-run
```
