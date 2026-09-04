#!/usr/bin/env bash
#
# Installation automatique d'AppartBudget sur un VPS Debian/Ubuntu :
# Node.js, PM2, dependances, base de donnees, comptes, build du frontend,
# reverse proxy nginx et certificat SSL Let's Encrypt.
#
# Concu pour cohabiter avec d'autres applications deja presentes sur le VPS :
# port dedie, process PM2 nomme, site nginx propre au sous-domaine fourni.
#
# Usage minimal (mode interactif, vous repondrez aux questions manquantes) :
#   sudo ./scripts/install.sh --domain budget.mondomaine.fr --email vous@example.com
#
# Usage 100% non-interactif (tout est fourni en arguments) :
#   sudo ./scripts/install.sh \
#     --domain budget.mondomaine.fr \
#     --email vous@example.com \
#     --port 4310 \
#     --user1-email vous@example.com --user1-name "Vous" --user1-password "..." --user1-color "#4f46e5" \
#     --user2-email conjoint@example.com --user2-name "Conjoint" --user2-password "..." --user2-color "#ec4899"
#
# Options utiles :
#   --skip-ssl        n'installe pas de certificat SSL (utile en test, sans DNS pointant vers ce serveur)
#   --skip-packages    ne tente pas d'installer nginx/certbot/Node via apt (deja presents)
#   --non-interactive  echoue au lieu de demander une saisie si une info manque
#
# Le script est concu pour etre relance sans danger (idempotent) : relancer
# apres une premiere installation reussie met simplement a jour l'app.

set -euo pipefail

# ---------------------------------------------------------------------------
# Couleurs / helpers d'affichage
# ---------------------------------------------------------------------------
C_BLUE="\033[1;34m"; C_GREEN="\033[1;32m"; C_YELLOW="\033[1;33m"; C_RED="\033[1;31m"; C_RESET="\033[0m"
step()  { echo -e "\n${C_BLUE}==>${C_RESET} $*"; }
info()  { echo -e "    $*"; }
ok()    { echo -e "${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo -e "${C_YELLOW}!${C_RESET} $*"; }
fail()  { echo -e "${C_RED}✗ $*${C_RESET}" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Localisation du projet (ce script vit dans <projet>/scripts/install.sh)
# ---------------------------------------------------------------------------
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_DIR="$APP_DIR/server"
PM2_APP_NAME="appartbudget"

# ---------------------------------------------------------------------------
# Valeurs par defaut / arguments
# ---------------------------------------------------------------------------
DOMAIN=""
CERTBOT_EMAIL=""
PORT="4310"
SKIP_SSL=false
SKIP_PACKAGES=false
NON_INTERACTIVE=false

U1_EMAIL=""; U1_NAME=""; U1_PASSWORD=""; U1_COLOR="#4f46e5"
U2_EMAIL=""; U2_NAME=""; U2_PASSWORD=""; U2_COLOR="#ec4899"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) CERTBOT_EMAIL="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --skip-ssl) SKIP_SSL=true; shift ;;
    --skip-packages) SKIP_PACKAGES=true; shift ;;
    --non-interactive) NON_INTERACTIVE=true; shift ;;
    --user1-email) U1_EMAIL="$2"; shift 2 ;;
    --user1-name) U1_NAME="$2"; shift 2 ;;
    --user1-password) U1_PASSWORD="$2"; shift 2 ;;
    --user1-color) U1_COLOR="$2"; shift 2 ;;
    --user2-email) U2_EMAIL="$2"; shift 2 ;;
    --user2-name) U2_NAME="$2"; shift 2 ;;
    --user2-password) U2_PASSWORD="$2"; shift 2 ;;
    --user2-color) U2_COLOR="$2"; shift 2 ;;
    -h|--help) awk 'NR==1{next} /^#/{sub(/^#[[:space:]]?/,""); print; next} {exit}' "$0"; exit 0 ;;
    *) fail "Option inconnue: $1 (voir --help)" ;;
  esac
done

prompt_if_missing() {
  # prompt_if_missing VAR_NAME "Question" [secret]
  local varname="$1" question="$2" secret="${3:-}"
  if [[ -n "${!varname}" ]]; then return; fi
  if $NON_INTERACTIVE; then
    fail "Argument manquant pour --$varname et --non-interactive est actif."
  fi
  if [[ "$secret" == "secret" ]]; then
    read -r -s -p "$question: " value; echo
  else
    read -r -p "$question: " value
  fi
  printf -v "$varname" '%s' "$value"
}

# ---------------------------------------------------------------------------
# 0. Verifications preliminaires
# ---------------------------------------------------------------------------
step "Verifications preliminaires"

if [[ $EUID -ne 0 ]]; then
  fail "Ce script doit etre execute avec les droits root (ex: sudo ./scripts/install.sh ...)."
fi

REAL_USER="${SUDO_USER:-$(whoami)}"
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"

prompt_if_missing DOMAIN "Nom de domaine (ex: budget.mondomaine.fr)"
if ! $SKIP_SSL; then
  prompt_if_missing CERTBOT_EMAIL "Email pour le certificat SSL (Let's Encrypt)"
fi

if [[ -z "$DOMAIN" ]]; then
  fail "Le nom de domaine est requis (--domain)."
fi

if ss -tulpn 2>/dev/null | grep -q ":$PORT "; then
  warn "Le port $PORT semble deja utilise par un autre process. Verifiez avant de continuer (option --port pour en choisir un autre)."
fi

ok "Domaine: $DOMAIN | Port applicatif: $PORT"

# ---------------------------------------------------------------------------
# 1. Paquets systeme (Node.js, nginx, certbot)
# ---------------------------------------------------------------------------
if $SKIP_PACKAGES; then
  step "Installation des paquets systeme ignoree (--skip-packages)"
else
  step "Installation des paquets systeme (nginx, certbot, outils de base)"
  if ! command -v apt-get >/dev/null 2>&1; then
    fail "Ce script automatise l'installation des paquets via apt (Debian/Ubuntu). Sur un autre systeme, installez manuellement Node.js 20+, nginx et certbot, puis relancez avec --skip-packages. Voir le README pour les etapes manuelles."
  fi

  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y curl ca-certificates gnupg nginx
  ok "Paquets de base installes (nginx inclus)."

  if command -v certbot >/dev/null 2>&1; then
    ok "certbot deja installe."
  elif $SKIP_SSL; then
    info "certbot non installe (SSL ignore via --skip-ssl)."
  else
    apt-get install -y certbot python3-certbot-nginx
    ok "certbot installe."
  fi
fi

step "Verification de Node.js (>= 20)"
NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed -E 's/^v([0-9]+).*/\1/')"
  if [[ "$NODE_MAJOR" -ge 20 ]]; then NODE_OK=true; fi
fi

if $NODE_OK; then
  ok "Node.js $(node -v) deja installe."
elif $SKIP_PACKAGES; then
  fail "Node.js 20+ est requis mais introuvable, et --skip-packages est actif. Installez Node.js 20+ puis relancez."
else
  step "Installation de Node.js 20 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  ok "Node.js $(node -v) installe."
fi

step "Verification de PM2"
if command -v pm2 >/dev/null 2>&1; then
  ok "PM2 deja installe."
else
  npm install -g pm2
  ok "PM2 installe."
fi
# Chemin absolu resolu maintenant (en root) : le PATH restreint utilise par
# `sudo -u` plus bas ne contient pas forcement le repertoire global npm
# (ex: installation via nvm ou prefixe npm personnalise).
PM2_BIN="$(command -v pm2)"

# ---------------------------------------------------------------------------
# 2. Dependances applicatives
# ---------------------------------------------------------------------------
step "Installation des dependances npm (racine, server, client)"
cd "$APP_DIR"
sudo -u "$REAL_USER" npm install
ok "Dependances installees."

# ---------------------------------------------------------------------------
# 3. Fichier .env
# ---------------------------------------------------------------------------
step "Configuration du fichier server/.env"
ENV_FILE="$SERVER_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  ok "server/.env existe deja, conserve tel quel (modifiez-le manuellement si besoin)."
else
  cp "$SERVER_DIR/.env.example" "$ENV_FILE"
  JWT_SECRET="$(openssl rand -hex 32)"
  sed -i "s#^PORT=.*#PORT=$PORT#" "$ENV_FILE"
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=\"$JWT_SECRET\"#" "$ENV_FILE"
  sed -i "s#^NODE_ENV=.*#NODE_ENV=production#" "$ENV_FILE"
  # Reste sur "false" pour l'instant : passe a "true" une fois le certificat SSL obtenu (etape 8).
  sed -i "s#^TRUST_PROXY_HTTPS=.*#TRUST_PROXY_HTTPS=false#" "$ENV_FILE"
  chown "$REAL_USER":"$REAL_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  ok "server/.env genere avec un secret aleatoire."
fi
# Recharge le port effectif depuis le .env (au cas ou le fichier existait deja avec un autre port)
PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2)"

# ---------------------------------------------------------------------------
# 4. Base de donnees (migrations Prisma)
# ---------------------------------------------------------------------------
step "Application des migrations de base de donnees"
sudo -u "$REAL_USER" npm run prisma:migrate --workspace server
ok "Base de donnees a jour."

step "Categories de depenses par defaut"
sudo -u "$REAL_USER" npm run seed:categories
ok "Categories verifiees/creees."

# ---------------------------------------------------------------------------
# 5. Comptes utilisateurs (vous + votre conjoint·e)
# ---------------------------------------------------------------------------
step "Comptes du foyer"
prompt_if_missing U1_EMAIL "Email du 1er compte"
prompt_if_missing U1_NAME "Nom affiche du 1er compte"
prompt_if_missing U1_PASSWORD "Mot de passe du 1er compte (8 caracteres min)" secret
prompt_if_missing U2_EMAIL "Email du 2e compte"
prompt_if_missing U2_NAME "Nom affiche du 2e compte"
prompt_if_missing U2_PASSWORD "Mot de passe du 2e compte (8 caracteres min)" secret

sudo -u "$REAL_USER" npm run create-user -- \
  --email "$U1_EMAIL" --name "$U1_NAME" --password "$U1_PASSWORD" --color "$U1_COLOR" >/dev/null
ok "Compte pret: $U1_NAME <$U1_EMAIL>"

sudo -u "$REAL_USER" npm run create-user -- \
  --email "$U2_EMAIL" --name "$U2_NAME" --password "$U2_PASSWORD" --color "$U2_COLOR" >/dev/null
ok "Compte pret: $U2_NAME <$U2_EMAIL>"

# ---------------------------------------------------------------------------
# 6. Build du frontend
# ---------------------------------------------------------------------------
step "Build du frontend (production)"
sudo -u "$REAL_USER" npm run build
ok "Frontend compile dans client/dist."

# ---------------------------------------------------------------------------
# 7. Demarrage / mise a jour via PM2
# ---------------------------------------------------------------------------
step "Demarrage de l'application avec PM2 (process: $PM2_APP_NAME)"
mkdir -p "$APP_DIR/logs"
chown "$REAL_USER":"$REAL_USER" "$APP_DIR/logs"

if sudo -u "$REAL_USER" env HOME="$REAL_HOME" "$PM2_BIN" describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  sudo -u "$REAL_USER" env HOME="$REAL_HOME" "$PM2_BIN" reload "$PM2_APP_NAME"
  ok "Process PM2 existant rechargee."
else
  sudo -u "$REAL_USER" env HOME="$REAL_HOME" "$PM2_BIN" start "$APP_DIR/ecosystem.config.js"
  ok "Process PM2 demarree."
fi
sudo -u "$REAL_USER" env HOME="$REAL_HOME" "$PM2_BIN" save

STARTUP_LINE="$("$PM2_BIN" startup systemd -u "$REAL_USER" --hp "$REAL_HOME" 2>/dev/null | grep -E '^sudo ' || true)"
if [[ -n "$STARTUP_LINE" ]] && eval "${STARTUP_LINE#sudo }"; then
  ok "Demarrage automatique de PM2 au reboot configure."
else
  warn "Impossible de configurer automatiquement le demarrage au reboot de PM2 (ex: pas de systemd disponible). Executez 'pm2 startup' manuellement si besoin, ce n'est pas bloquant."
fi

# ---------------------------------------------------------------------------
# 8. Reverse proxy nginx + SSL
# ---------------------------------------------------------------------------
step "Configuration du reverse proxy nginx pour $DOMAIN"
NGINX_SITE="/etc/nginx/sites-available/appartbudget-$DOMAIN"
cat > "$NGINX_SITE" <<NGINXCONF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINXCONF

ln -sf "$NGINX_SITE" "/etc/nginx/sites-enabled/appartbudget-$DOMAIN"
if nginx -t; then
  systemctl reload nginx
  ok "Site nginx active pour $DOMAIN (HTTP)."
else
  fail "La configuration nginx generee est invalide. Verifiez $NGINX_SITE."
fi

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null || true
  ufw allow OpenSSH >/dev/null || true
  ok "Regles pare-feu ufw verifiees (80/443 + SSH ouverts)."
fi

if $SKIP_SSL; then
  step "SSL ignore (--skip-ssl) : l'application reste accessible en HTTP uniquement pour l'instant."
else
  step "Obtention du certificat SSL (Let's Encrypt) pour $DOMAIN"
  if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect; then
    ok "Certificat SSL obtenu et configure (redirection HTTPS activee)."
    sed -i "s#^TRUST_PROXY_HTTPS=.*#TRUST_PROXY_HTTPS=true#" "$ENV_FILE"
    sudo -u "$REAL_USER" env HOME="$REAL_HOME" "$PM2_BIN" restart "$PM2_APP_NAME"
    ok "Cookies de session marques 'secure', application redemarree."
  else
    warn "Echec de l'obtention du certificat SSL. Verifiez que le DNS de $DOMAIN pointe bien vers ce serveur, puis relancez :"
    warn "  certbot --nginx -d $DOMAIN --agree-tos -m $CERTBOT_EMAIL"
  fi
fi

# ---------------------------------------------------------------------------
# 9. Sauvegarde automatique quotidienne
# ---------------------------------------------------------------------------
step "Sauvegarde quotidienne de la base de donnees"
BACKUP_DIR="/var/backups/appartbudget"
mkdir -p "$BACKUP_DIR"
chown "$REAL_USER":"$REAL_USER" "$BACKUP_DIR"
CRON_LINE="0 4 * * * $REAL_USER cp $SERVER_DIR/data/appartbudget.db $BACKUP_DIR/appartbudget-\$(date +\\%F).db 2>/dev/null; find $BACKUP_DIR -name '*.db' -mtime +30 -delete"
CRON_FILE="/etc/cron.d/appartbudget-backup"
if [[ -f "$CRON_FILE" ]] && grep -qF "$SERVER_DIR/data/appartbudget.db" "$CRON_FILE"; then
  ok "Sauvegarde quotidienne deja configuree."
else
  echo "$CRON_LINE" > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
  ok "Sauvegarde quotidienne planifiee (4h du matin) dans $BACKUP_DIR (conservees 30 jours)."
fi

# ---------------------------------------------------------------------------
# Recapitulatif
# ---------------------------------------------------------------------------
PROTOCOL="http"
$SKIP_SSL || PROTOCOL="https"
echo
echo -e "${C_GREEN}=========================================================${C_RESET}"
echo -e "${C_GREEN} AppartBudget est installe et lance !${C_RESET}"
echo -e "${C_GREEN}=========================================================${C_RESET}"
echo -e "  URL              : ${C_BLUE}${PROTOCOL}://${DOMAIN}${C_RESET}"
echo -e "  Compte 1         : $U1_EMAIL"
echo -e "  Compte 2         : $U2_EMAIL"
echo -e "  Process PM2      : $PM2_APP_NAME (pm2 status / pm2 logs $PM2_APP_NAME)"
echo -e "  Sauvegardes      : $BACKUP_DIR (quotidiennes, 30 jours)"
echo
echo -e "  Pour mettre a jour l'application plus tard, executez simplement :"
echo -e "    cd $APP_DIR && ./scripts/update.sh"
echo -e "  (aucun git pull ni git checkout manuel necessaire, voir le README)"
echo
