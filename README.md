# Palm Villa POS

Palm Villa is a staff ordering app and manager dashboard served by a Node.js application. SQLite stores shared orders, prices, sales, expenses, inventory, accounts, and audit events. Staff and managers sign in separately; the server enforces permissions and calculates sale totals from its menu database.

## Run locally

Requires Node.js 22.13 or newer. Copy `.env.example` to `.env`, set a unique manager username and password (at least 12 characters), and replace `SESSION_SECRET` with a random value of at least 32 characters. Keep `.env` private and keep `SESSION_SECRET` unchanged between restarts.

```bash
npm start
```

Open `http://localhost:3000`. The initial manager account is created once from the environment settings. After signing in, use **Add Staff Account** to create staff logins. Change the initial password from the dashboard.

Run the automated backend checks with:

```bash
npm test
```

## Data, backups, and migration

SQLite files and daily backups default to sibling folders outside this repository (`../palmvilla-data` and `../palmvilla-backups`). Set `DATABASE_PATH` and `BACKUP_PATH` to persistent writable storage on the production server. The server creates one SQLite snapshot per business day and keeps the latest 30 days. Copy backups to separate offsite storage regularly; a backup on the same server cannot recover from server or disk loss.

To move records from the older browser-only version, open `/migration.html` on the old site and download its export before changing the site address. After the Node server is online, sign in as manager, open `/migration.html`, and import that file. The import is one-time per business date; keep the downloaded file as a private backup.

## Hosting

GitHub is the source-code repository. GitHub Pages and a custom domain name alone cannot run this API or persist its SQLite database. The included `render.yaml` provides a Render setup with a persistent disk; follow [README_DEPLOY.md](README_DEPLOY.md) to connect GitHub, create the manager login, import old browser data, and optionally point your own domain at the service. A persistent disk requires a paid Render service. Never upload `.env`, database files, or backup files to GitHub.

For production, set `NODE_ENV=production` behind HTTPS so session cookies are marked secure. Keep the server database and backups on persistent storage; schedule an additional offsite copy.

## Project files

- `server.js`: authenticated API, database, static file server, daily backups.
- `index.html`: manager dashboard; `orders.html`: staff orders and summary; `debts.html`: manager debt ledger.
- `script.js`, `api.js`, `login.js`: browser interface and same-origin API client.
- `migration.html`, `migration.js`: export old browser records and import them on the secure server.
- `style.css`, `manifest.json`, `sw.js`, `logo-*.svg`: styling and PWA assets.
- `test/server.test.js`: API, permissions, price, sales, and backup checks.

## Configuration and security

Do not use `python3 -m http.server` or a static-only host for the live POS. The Node server protects dashboard routes and business APIs. Use individual staff accounts, choose strong unique passwords, use HTTPS in production, retain offsite backups, and never commit credentials or customer exports.
