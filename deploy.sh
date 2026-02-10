#!/bin/bash
set -e

# =============================================
# Zeiterfassung - Deployment auf neuem Server
# =============================================
# Voraussetzung: Docker + Docker Compose
#
# Nutzung:
#   curl -fsSL https://raw.githubusercontent.com/kerimatilgan/Zeiterfassung/main/deploy.sh | bash
#   oder: ./deploy.sh
# =============================================

INSTALL_DIR="/opt/Zeiterfassung"
REGISTRY="ghcr.io/kerimatilgan"

echo "========================================"
echo "  Zeiterfassung - Deployment"
echo "========================================"
echo ""

# 1. Docker prüfen
if ! command -v docker &> /dev/null; then
    echo "[1/5] Docker nicht gefunden. Installiere Docker..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "  -> Docker installiert"
else
    echo "[1/5] Docker vorhanden: $(docker --version)"
fi

# 2. Verzeichnis vorbereiten
echo "[2/5] Erstelle Verzeichnisse..."
mkdir -p "$INSTALL_DIR"/{data,reports,uploads}

# 3. docker-compose.yml herunterladen (nur Image-basiert, kein Build nötig)
echo "[3/5] Lade Konfiguration herunter..."
cat > "$INSTALL_DIR/docker-compose.yml" << 'COMPOSE'
services:
  backend:
    image: ghcr.io/kerimatilgan/zeiterfassung-backend:latest
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - JWT_SECRET=${JWT_SECRET:-handy-insel-zeiterfassung-secret-key-2024}
      - TERMINAL_API_KEY=${TERMINAL_API_KEY:-handy-insel-terminal-key-2024}
    volumes:
      - ./data:/app/prisma
      - ./reports:/app/reports
      - ./uploads:/app/uploads
    restart: unless-stopped

  frontend:
    image: ghcr.io/kerimatilgan/zeiterfassung-frontend:latest
    ports:
      - "80:80"
    depends_on:
      - backend
    restart: unless-stopped

  terminal:
    image: ghcr.io/kerimatilgan/zeiterfassung-terminal:latest
    ports:
      - "8080:80"
    depends_on:
      - backend
    restart: unless-stopped
COMPOSE

# 4. .env Datei (falls nicht vorhanden)
if [ ! -f "$INSTALL_DIR/.env" ]; then
    echo "[3.5/5] Erstelle .env Datei..."
    JWT_SECRET=$(openssl rand -hex 32)
    cat > "$INSTALL_DIR/.env" << EOF
JWT_SECRET=$JWT_SECRET
TERMINAL_API_KEY=handy-insel-terminal-key-2024
EOF
    echo "  -> .env erstellt mit generiertem JWT_SECRET"
    echo "  -> Bitte TERMINAL_API_KEY in $INSTALL_DIR/.env anpassen!"
else
    echo "[3.5/5] .env existiert bereits - wird beibehalten"
fi

# 5. Images pullen und starten
echo "[4/5] Lade Docker Images herunter (pre-built)..."
cd "$INSTALL_DIR"
docker compose pull

echo "[5/5] Starte Anwendung..."
docker compose up -d

echo ""
echo "========================================"
echo "  Deployment abgeschlossen!"
echo "========================================"
echo ""
echo "  Frontend:     http://$(hostname -I | awk '{print $1}'):80"
echo "  Backend API:  http://$(hostname -I | awk '{print $1}'):3001"
echo "  Terminal:     http://$(hostname -I | awk '{print $1}'):8080"
echo ""
echo "  Daten:        $INSTALL_DIR/data/"
echo "  Reports:      $INSTALL_DIR/reports/"
echo "  Uploads:      $INSTALL_DIR/uploads/"
echo "  Config:       $INSTALL_DIR/.env"
echo ""
echo "  Logs:         docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
echo "  Neustart:     docker compose -f $INSTALL_DIR/docker-compose.yml restart"
echo "  Update:       docker compose -f $INSTALL_DIR/docker-compose.yml pull && docker compose -f $INSTALL_DIR/docker-compose.yml up -d"
echo ""
