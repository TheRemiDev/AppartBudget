#!/usr/bin/env bash
#
# Met a jour AppartBudget vers la derniere version de la branche configuree
# et redemarre l'application. Se remet TOUJOURS sur la bonne branche avant
# de mettre a jour (checkout force sur origin/<branche>) : inutile de faire
# vous-meme un `git checkout main && git pull` avant de lancer ce script.
#
# Usage:
#   ./scripts/update.sh                  # met a jour depuis origin/main
#   ./scripts/update.sh --branch develop # met a jour depuis une autre branche
#   ./scripts/update.sh --force          # ecrase aussi d'eventuelles modifs locales non commitees
#   ./scripts/update.sh --no-restart     # met a jour le code sans redemarrer PM2
#
# A lancer en tant qu'utilisateur proprietaire de l'application (celui qui a
# execute install.sh). Si lance avec sudo/root, le script bascule
# automatiquement vers ce proprietaire pour git/npm/pm2 (evite de polluer
# les fichiers avec des droits root).
#
# Peut aussi etre planifie (cron) pour se mettre a jour automatiquement,
# par exemple chaque nuit :
#   0 5 * * * /chemin/vers/appartbudget/scripts/update.sh >> /var/log/appartbudget-update.log 2>&1

set -euo pipefail

C_BLUE="\033[1;34m"; C_GREEN="\033[1;32m"; C_YELLOW="\033[1;33m"; C_RED="\033[1;31m"; C_RESET="\033[0m"
step()  { echo -e "\n${C_BLUE}==>${C_RESET} $*"; }
ok()    { echo -e "${C_GREEN}✓${C_RESET} $*"; }
warn()  { echo -e "${C_YELLOW}!${C_RESET} $*"; }
fail()  { echo -e "${C_RED}✗ $*${C_RESET}" >&2; exit 1; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PM2_APP_NAME="appartbudget"

BRANCH="main"
RESTART=true
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch) BRANCH="$2"; shift 2 ;;
    --force) FORCE=true; shift ;;
    --no-restart) RESTART=false; shift ;;
    -h|--help) awk 'NR==1{next} /^#/{sub(/^#[[:space:]]?/,""); print; next} {exit}' "$0"; exit 0 ;;
    *) fail "Option inconnue: $1 (voir --help)" ;;
  esac
done

cd "$APP_DIR"
[[ -d .git ]] || fail "Pas un depot git: $APP_DIR"

# Si lance en root (ex: cron systeme), on bascule vers le proprietaire reel
# du projet pour que git/npm/pm2 s'executent avec les bons droits.
if [[ $EUID -eq 0 ]]; then
  REAL_USER="${SUDO_USER:-$(stat -c '%U' "$APP_DIR")}"
else
  REAL_USER="$(whoami)"
fi
REAL_HOME="$(getent passwd "$REAL_USER" | cut -d: -f6)"

as_owner() {
  if [[ "$(whoami)" == "$REAL_USER" ]]; then
    "$@"
  else
    sudo -u "$REAL_USER" env HOME="$REAL_HOME" "$@"
  fi
}

# Resolution robuste du binaire pm2 : le PATH minimal utilise par cron (ou le
# PATH restreint de `sudo -u`) ne contient pas toujours le repertoire global
# npm (installation via nvm, prefixe personnalise...). On essaie d'abord un
# shell de connexion (qui charge le profil de l'utilisateur), puis le
# prefixe npm global en dernier recours.
resolve_pm2_bin() {
  local candidate
  candidate="$(as_owner bash -lc 'command -v pm2' 2>/dev/null || true)"
  if [[ -z "$candidate" ]]; then
    local prefix
    prefix="$(as_owner npm config get prefix 2>/dev/null || true)"
    if [[ -n "$prefix" && -x "$prefix/bin/pm2" ]]; then
      candidate="$prefix/bin/pm2"
    fi
  fi
  [[ -n "$candidate" ]] || fail "Impossible de localiser l'executable pm2 pour l'utilisateur $REAL_USER. Verifiez qu'il est installe (npm install -g pm2)."
  echo "$candidate"
}
PM2_BIN="$(resolve_pm2_bin)"

step "Depot: $APP_DIR (branche cible: $BRANCH, utilisateur: $REAL_USER)"

step "Recuperation des derniers changements (origin/$BRANCH)"
as_owner git fetch origin "$BRANCH"

if [[ -n "$(as_owner git status --porcelain)" ]]; then
  if $FORCE; then
    warn "Modifications locales non commitees detectees : elles vont etre ecrasees (--force)."
    as_owner git reset --hard
  else
    fail "Modifications locales non commitees detectees dans $APP_DIR. Committez/annulez-les, ou relancez avec --force pour les ecraser."
  fi
fi

CURRENT_COMMIT="$(as_owner git rev-parse HEAD)"
as_owner git checkout -B "$BRANCH" "origin/$BRANCH"
NEW_COMMIT="$(as_owner git rev-parse HEAD)"

if [[ "$CURRENT_COMMIT" == "$NEW_COMMIT" ]]; then
  ok "Deja a jour (rien a faire) : $NEW_COMMIT"
  if ! $RESTART; then exit 0; fi
else
  ok "Mis a jour: $CURRENT_COMMIT -> $NEW_COMMIT"
fi

step "Installation des dependances"
as_owner npm install
ok "Dependances a jour (le client Prisma est regenere automatiquement)."

step "Application des migrations de base de donnees"
as_owner npm run prisma:migrate --workspace server
ok "Base de donnees a jour."

step "Build du frontend"
as_owner npm run build
ok "Frontend recompile."

if ! $RESTART; then
  ok "Mise a jour terminee (redemarrage ignore, --no-restart)."
  exit 0
fi

step "Redemarrage de l'application (PM2: $PM2_APP_NAME)"
if as_owner "$PM2_BIN" describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  as_owner "$PM2_BIN" reload "$PM2_APP_NAME"
  ok "Application rechargee sans interruption."
else
  warn "Aucun process PM2 nomme '$PM2_APP_NAME' trouve. Lancement initial..."
  as_owner "$PM2_BIN" start "$APP_DIR/ecosystem.config.js"
  ok "Application demarree."
fi
as_owner "$PM2_BIN" save

echo
ok "Mise a jour terminee."
