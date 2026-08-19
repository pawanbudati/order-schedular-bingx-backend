# 🐧 Ubuntu Linux AWS VM Setup & Automated SSL Guide

This guide details how to set up your fresh **Ubuntu Linux AWS EC2 VM** and configure a free **Let's Encrypt SSL Certificate** with **Nginx Reverse Proxy** for the BingX Order Scheduler Backend.

---

## 📋 Step 1: AWS EC2 Security Group Prerequisites

In your AWS Management Console for your EC2 Instance, ensure your Security Group inbound rules allow:
- **Port 80 (HTTP)**: `0.0.0.0/0` (Required for Certbot validation & HTTP -> HTTPS 301 redirect)
- **Port 443 (HTTPS)**: `0.0.0.0/0` (Required for SSL traffic)
- **Port 22 (SSH)**: `0.0.0.0/0` or your IP
- **Port 8445**: `0.0.0.0/0` (Optional backend direct port)

---

## ⚡ Step 2: One-Time Ubuntu VM Setup Script

On your fresh Ubuntu AWS VM, run the initial environment installer script:

```bash
# 1. Navigate to backend scripts folder
cd ~/order-schedular-bingx-backend/scripts

# 2. Make scripts executable
chmod +x setup-ubuntu-vm.sh setup-ssl-ubuntu.sh

# 3. Run initial Ubuntu environment setup
sudo ./setup-ubuntu-vm.sh
```

### What `setup-ubuntu-vm.sh` installs automatically:
- System updates & build tools (`git`, `curl`, `ufw`, `ca-certificates`)
- **Node.js 20.x LTS** via NodeSource repository
- **PM2 Process Manager** globally (configured to auto-start on VM reboot)
- **Nginx Web Server** and **Certbot**
- UFW Firewall rules for ports 22, 80, 443, 8445

---

## 🔐 Step 3: Automated SSL Certificate & Nginx Proxy Setup

After pointing your domain or subdomain DNS A-record (e.g., `api.yourdomain.com`) to your EC2 Public IP address, run:

```bash
sudo ./setup-ssl-ubuntu.sh
```

### What `setup-ssl-ubuntu.sh` configures automatically:
1. Creates Nginx Reverse Proxy block forwarding HTTPS traffic (`:443`) to local Node.js engine (`127.0.0.1:8445`).
2. Configures WebSocket upgrade headers (`wss://`) and zero-buffering for low latency execution.
3. Obtains Let's Encrypt SSL certificate & sets up automatic HTTP -> HTTPS redirect.
4. Verifies automated SSL certificate renewal.

---

## 🌐 Updated Production Endpoints

Once active, update your frontend configuration:

- **HTTPS API Endpoint**: `https://api.yourdomain.com/api`
- **WSS WebSocket Endpoint**: `wss://api.yourdomain.com`
- **Health Check**: `https://api.yourdomain.com/health`
