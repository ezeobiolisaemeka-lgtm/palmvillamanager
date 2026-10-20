# Production deployment notes

## Recommended setup: Render + GitHub

The repository now includes `render.yaml` to define a Node web service, HTTPS health check, SQLite location, and persistent disk. Render's persistent disk requires a paid web service; the free service filesystem is temporary and would lose the POS database after a restart or deploy. GitHub Pages is static and cannot run this backend.

1. Push the reviewed project to the existing GitHub repository's `main` branch. GitHub Actions runs the Node checks before Render deploys.
2. Sign in to Render, choose **New > Blueprint**, connect `ezeobiolisaemeka-lgtm/palmvillamanager`, and select `main` and `render.yaml`.
3. During setup, enter a manager username (at least 3 characters) and a strong unique manager password (at least 12 characters). Render generates the session secret. Keep all secrets in Render's private environment settings.
4. Create the service with the persistent disk in the Blueprint. Wait for the health check to pass, then open the Render service URL and sign in. Change the manager password if desired, and remove `MANAGER_PASSWORD` from the service settings after the first manager account has been created.
5. Before changing the old site's address, export the old browser data using its `/migration.html` page. Sign in to the new server and import that JSON at `/migration.html`. Verify menu prices, customers, debt balances, payments, sales, and reports.
6. If you own a domain, add it in the Render service's **Settings > Custom Domains**, then copy the DNS records Render shows into your domain registrar. Wait for DNS and HTTPS activation before giving staff the new address.

Render documents that persistent disks preserve only files under their mount path and are available on paid web services. Keep the SQLite database and backup directory on that disk, and separately copy backups offsite. [Persistent disk guide](https://render.com/docs/disks), [Blueprint reference](https://render.com/docs/blueprint-spec).

GitHub Pages only publishes static files and cannot run the POS backend. [GitHub Pages documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Other Node hosts

Any host can run this app if it supports Node.js 22.13 or newer and a persistent writable volume. Set `npm start` as the start command and configure the variables below. Set `DATABASE_PATH` and `BACKUP_PATH` within the host's persistent volume.

Set these private environment variables in the host dashboard:

- `NODE_ENV=production`
- `SESSION_SECRET` (random, at least 32 characters; keep it stable)
- `MANAGER_USERNAME` and `MANAGER_PASSWORD` for the first startup only
- `DATABASE_PATH` on persistent storage
- `BACKUP_PATH` on persistent storage; copy backups offsite on a schedule
- `BUSINESS_TIME_ZONE=Africa/Lagos`

The first startup creates the manager account if it does not already exist. The server stores password hashes, never the original password. Change the manager password after the first sign-in, then remove `MANAGER_PASSWORD` from the host configuration. Keep `SESSION_SECRET` configured.

Use the host's HTTPS endpoint or terminate TLS at a trusted reverse proxy. Confirm its persistent disk survives deploys and restarts. Before directing a custom domain to the new server, export old browser data from `/migration.html`; import it after signing in to the new server as manager. Check `/api/health` after deployment, then sign in from one staff device and the manager device to confirm both connect to the same records.

Never deploy the repository root as a static site for live use. The app requires `server.js`, and the SQLite database must remain outside Git and backed up to separate storage.
