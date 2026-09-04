# AppartBudget

Application privée de suivi du budget et des dépenses du foyer, pensée pour
deux personnes. Chacun peut ajouter des dépenses (fixes ou exceptionnelles),
les répartir comme il le souhaite (parts égales, pourcentages ou montants
personnalisés), et confirmer de son côté le règlement de sa part. Le tableau
de bord donne une vue claire par semaine, mois ou année, avec des graphiques
de répartition et d'évolution.

## Fonctionnalités

- **Authentification sécurisée** — comptes nominatifs (pas d'inscription
  publique), mots de passe hashés (bcrypt), sessions signées (JWT en cookie
  `httpOnly`), limitation du taux de tentatives de connexion.
- **Catégories personnalisables** — créez vos propres types de dépenses
  (loyer, électricité, gaz, internet, courses, loisirs...) avec icône,
  couleur et type par défaut (fixe / exceptionnel).
- **Dépenses & répartition** — chaque dépense peut être répartie entre les
  membres du foyer en parts égales, en pourcentages ou en montants
  personnalisés. Chaque personne confirme uniquement **sa propre part** —
  personne ne peut valider le paiement de l'autre.
- **Charges récurrentes** — définissez le loyer, l'électricité, le gaz,
  l'internet... une fois, avec leur jour d'échéance ; l'application génère
  automatiquement la dépense du mois (tâche planifiée nocturne, sans
  doublons).
- **Tableau de bord** — totaux par période (semaine / mois / année),
  répartition par catégorie (camembert), évolution sur 6 mois (barres),
  montant réglé / en attente par personne, liste des paiements à confirmer.
- **Design** sobre, moderne, clair, adapté au thème clair/sombre du
  système.

## Stack technique

- **Backend** : Node.js (ESM) + Express + Prisma ORM + SQLite (aucun
  serveur de base de données à installer, un simple fichier).
- **Frontend** : React + Vite + React Router + Recharts, compilé en
  fichiers statiques servis directement par le serveur Express (un seul
  process, un seul port).
- **Process manager recommandé** : PM2.

## Arborescence

```
AppartBudget/
├── server/            # API Express + Prisma (SQLite)
│   ├── prisma/         # schema.prisma + migrations
│   ├── scripts/        # création d'utilisateurs, seed des catégories
│   └── src/
├── client/            # Application React (Vite)
├── ecosystem.config.js # Config PM2
└── README.md
```

## Installation en local (développement)

Prérequis : Node.js 20+.

```bash
# 1. Installer toutes les dépendances (workspaces racine)
npm install

# 2. Configurer le backend
cp server/.env.example server/.env
# Éditez server/.env : générez un JWT_SECRET solide, par exemple :
openssl rand -hex 32

# 3. Créer la base SQLite et appliquer les migrations
npm run prisma:migrate --workspace server

# 4. Créer les catégories de départ (loyer, électricité, gaz...)
npm run seed:categories

# 5. Créer vos deux comptes (le vôtre et celui de votre conjoint·e)
npm run create-user -- --email vous@example.com --name "Vous" --password "un-mot-de-passe-solide" --color "#4f46e5"
npm run create-user -- --email conjoint@example.com --name "Conjoint" --password "un-mot-de-passe-solide" --color "#ec4899"

# 6. Lancer le backend (port 4310 par défaut) et le frontend en parallèle
npm run dev:server
npm run dev:client   # dans un second terminal, sur http://localhost:5173
```

En développement, le frontend (Vite, port 5173) proxifie les appels `/api`
vers le backend (port 4310).

## Déploiement sur un VPS partagé (sans interférer avec vos autres apps)

L'application est conçue pour cohabiter avec d'autres programmes Node déjà
en place : elle tourne dans **son propre process**, sur **son propre port**,
avec **sa propre base de données fichier** — rien n'est partagé.

### 1. Récupérer le projet et l'installer

```bash
cd /var/www              # ou tout autre dossier dédié à vos apps
git clone <url-du-repo> appartbudget
cd appartbudget
npm install
```

### 2. Configurer l'environnement

```bash
cp server/.env.example server/.env
nano server/.env
```

Dans `server/.env` :
- `PORT` — choisissez un port **libre** sur le VPS (vérifiez avec
  `ss -tulpn | grep <port>` qu'il n'est pas déjà utilisé par une autre app).
- `JWT_SECRET` — générez une valeur aléatoire longue :
  `openssl rand -hex 32`.
- `TRUST_PROXY_HTTPS=true` si vous passez par un reverse proxy HTTPS
  (recommandé, voir plus bas).

### 3. Initialiser la base de données et les comptes

```bash
npm run prisma:migrate --workspace server   # applique les migrations (prisma migrate deploy)
npm run seed:categories                     # catégories de départ
npm run create-user -- --email vous@example.com --name "Vous" --password "..." --color "#4f46e5"
npm run create-user -- --email conjoint@example.com --name "Conjoint" --password "..." --color "#ec4899"
```

### 4. Construire le frontend

```bash
npm run build
```

Le serveur Express sert automatiquement `client/dist` en production —
un seul process à faire tourner.

### 5. Démarrer avec PM2 (recommandé)

PM2 permet de faire cohabiter plusieurs applications Node sur le même VPS,
chacune identifiée par un nom de process distinct.

```bash
npm install -g pm2   # si ce n'est pas déjà fait sur le VPS
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save              # persiste la liste des process au redémarrage du VPS
pm2 startup           # (à exécuter une seule fois, suivez les instructions affichées)
```

Commandes utiles, qui n'affectent que **cette** application (le nom
`appartbudget` cible uniquement son process) :

```bash
pm2 status appartbudget
pm2 logs appartbudget
pm2 restart appartbudget
pm2 stop appartbudget
```

### 6. Exposer l'application via un reverse proxy (recommandé)

Pour un accès HTTPS propre (ex: `budget.mondomaine.fr`) sans exposer le
port applicatif directement, utilisez nginx comme reverse proxy — c'est
aussi ce qui permet de faire cohabiter plusieurs apps Node sur le port 443
avec des sous-domaines différents.

Exemple de bloc de configuration nginx (`/etc/nginx/sites-available/appartbudget`) :

```nginx
server {
    listen 80;
    server_name budget.mondomaine.fr;

    location / {
        proxy_pass http://127.0.0.1:4310;   # le PORT choisi dans server/.env
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/appartbudget /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Activer le HTTPS gratuit avec Let's Encrypt
sudo certbot --nginx -d budget.mondomaine.fr
```

Une fois le HTTPS actif, repassez dans `server/.env` mettre
`TRUST_PROXY_HTTPS=true` puis `pm2 restart appartbudget` pour que le cookie
de session soit marqué `secure`.

### 7. Mettre à jour l'application plus tard

```bash
cd /var/www/appartbudget
git pull
npm install
npm run prisma:migrate --workspace server
npm run build
pm2 restart appartbudget
```

### 8. Sauvegarder vos données

Toutes les données vivent dans un seul fichier SQLite :
`server/data/appartbudget.db`. Une sauvegarde régulière suffit :

```bash
# exemple de cron quotidien (crontab -e)
0 4 * * * cp /var/www/appartbudget/server/data/appartbudget.db /var/backups/appartbudget-$(date +\%F).db
```

## Sécurité

- Aucune inscription publique : les comptes sont créés uniquement via le
  script `create-user` (accès serveur requis), ce qui garantit que seuls
  vous et votre conjoint·e avez accès à l'application.
- Mots de passe hashés avec bcrypt (jamais stockés en clair).
- Sessions via cookie `httpOnly` + `sameSite=lax`, signées et à expiration
  automatique.
- Chaque utilisateur ne peut confirmer/annuler que **sa propre part** d'une
  dépense — l'API rejette toute tentative de modifier la part de l'autre.
- En-têtes de sécurité HTTP via Helmet, limitation du taux de requêtes sur
  la connexion.
- Pensez à toujours passer par HTTPS en production (voir section reverse
  proxy ci-dessus).

## Modèle de répartition

Pour une dépense de montant total *M* :
- **Parts égales** : *M* est divisé équitablement entre les participants
  sélectionnés (au centime près, sans perte d'arrondi).
- **Pourcentages** : vous définissez le pourcentage de chacun (doit
  totaliser 100 %).
- **Montants personnalisés** : vous définissez directement la part en euros
  de chacun (doit totaliser le montant de la dépense).

Chaque part est ensuite confirmée indépendamment par son destinataire.
