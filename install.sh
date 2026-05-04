#!/bin/bash
# File: install.sh
# =============================================================================
# PlanBase - Bare-Metal Deployment Script (Debian/Ubuntu)
# =============================================================================
set -euo pipefail

APP_NAME="planbase"
APP_DIR="/opt/$APP_NAME"
APP_USER="planbase"
APP_PORT=3000
DOMAIN=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""

log()  { echo -e "\033[0;32m[*]\033[0m $*"; }
err()  { echo -e "\033[0;31m[x]\033[0m $*" >&2; exit 1; }

if [ "$EUID" -ne 0 ]; then err "Please run as root (sudo)."; fi

read -rp "Admin email: " ADMIN_EMAIL
read -rsp "Admin password: " ADMIN_PASSWORD; echo

log "Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl nginx sqlite3 build-essential

if ! command -v node &>/dev/null; then
  log "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi

log "Setting up system user and directories..."
if ! id -u "$APP_USER" &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -d "$APP_DIR" "$APP_USER"
fi
mkdir -p "$APP_DIR/src" "$APP_DIR/prisma"

log "Deploying scaffolding..."
cp package.json "$APP_DIR/"
cp prisma/schema.prisma "$APP_DIR/prisma/"
cp src/server.ts "$APP_DIR/src/"
cp src/App.jsx "$APP_DIR/src/"

cat > "$APP_DIR/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022", "module": "commonjs", "outDir": "./dist-api",
    "rootDir": "./src", "esModuleInterop": true, "strict": true
  },
  "include": ["src/**/*.ts"]
}
EOF

cat > "$APP_DIR/index.html" <<'EOF'
<!DOCTYPE html>
<html lang="en">
  <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>PlanBase</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body>
</html>
EOF

cat > "$APP_DIR/src/main.jsx" <<'EOF'
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
EOF

cat > "$APP_DIR/src/index.css" <<'EOF'
@tailwind base; @tailwind components; @tailwind utilities;
EOF

cat > "$APP_DIR/tailwind.config.mjs" <<'EOF'
export default { content: ['./index.html', './src/**/*.{js,jsx}'], theme: { extend: {} }, plugins: [] };
EOF

cat > "$APP_DIR/postcss.config.mjs" <<'EOF'
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
EOF

cat > "$APP_DIR/vite.config.mjs" <<EOF
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:$APP_PORT' } }
});
EOF

log "Writing environment configuration..."
JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
cat > "$APP_DIR/.env" <<EOF
PORT=$APP_PORT
JWT_SECRET=$JWT_SECRET
DATABASE_URL="file:./prod.db"
EOF
chmod 600 "$APP_DIR/.env"

log "Installing dependencies & Building..."
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm install"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npx prisma db push"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm run build"

log "Seeding Admin..."
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && node -e \"
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
async function seed() {
  const hash = await bcrypt.hash('$ADMIN_PASSWORD', 12);
  await prisma.user.upsert({
    where: { email: '$ADMIN_EMAIL' },
    update: { passwordHash: hash, role: 'ADMIN' },
    create: { name: 'Admin', email: '$ADMIN_EMAIL', passwordHash: hash, role: 'ADMIN' }
  });
}
seed().then(()=>process.exit(0));
\""

log "Configuring systemd & Nginx..."
cat > "/etc/systemd/system/$APP_NAME.service" <<EOF
[Unit]
Description=PlanBase Backend
After=network.target
[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$APP_DIR/.env
ExecStart=/usr/bin/node dist-api/server.js
Restart=always
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$APP_NAME"

IP_ADDRESS="$(hostname -I | awk '{print $1}')"
cat > "/etc/nginx/sites-available/$APP_NAME" <<EOF
server {
    listen 80;
    server_name _;
    root $APP_DIR/dist;
    index index.html;
    location / { try_files \$uri \$uri/ /index.html; }
    location /api/ { proxy_pass http://localhost:$APP_PORT; }
}
EOF
ln -sf "/etc/nginx/sites-available/$APP_NAME" "/etc/nginx/sites-enabled/$APP_NAME"
rm -f /etc/nginx/sites-enabled/default
systemctl reload nginx

log "Installation complete! Access at http://$IP_ADDRESS"
