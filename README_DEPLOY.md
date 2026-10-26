# Production deployment notes

## Cloudflare Workers + D1 (recommended)

The production app is a Cloudflare Worker backed by D1. Do not publish the repository as a Pages-only static site: sign-in, orders, debts, and reports need the Worker and database. The Worker serves an allowlist of frontend files, so backend source and configuration are not exposed as website assets.

### Create the production database

1. Install Node.js 22 or newer. In the repository, run `npm ci`, then `npx wrangler login` and complete Cloudflare's browser sign-in.
2. Create the production database and update the local Wrangler config: `npx wrangler d1 create palm-villa-pos --binding DB --update-config`. Confirm `wrangler.toml` has a real `database_id`, then commit that non-secret ID. Never commit account tokens or app passwords.
3. Before a live launch, export existing browser data from the old app's `/migration.html` and keep the export private. It contains customer and business records.

### Connect GitHub Actions deployment

The repository includes `.github/workflows/cloudflare-deploy.yml`. It deploys on pushes to `main` after deployment is enabled, and supports a manual run from GitHub Actions. Before enabling it, create the D1 database and commit its real ID in `wrangler.toml`.

1. In GitHub, open the repository's **Settings > Secrets and variables > Actions**. Add repository secrets `CLOUDFLARE_API_TOKEN` (a token with Workers Scripts edit and D1 edit permissions) and `CLOUDFLARE_ACCOUNT_ID`.
2. Under **Variables**, add `CLOUDFLARE_DEPLOY_ENABLED` with value `true`. This enables deployments on pushes to `main`.
3. Add these as encrypted Worker secrets in Cloudflare **Workers & Pages > palm-villa-pos > Settings > Variables and Secrets** before opening the app:
   - `SESSION_SECRET`: unique random string of at least 32 characters; keep it stable across deployments.
   - `MANAGER_USERNAME`: at least 3 characters.
   - `MANAGER_PASSWORD`: unique password of at least 12 characters.
4. Run **Deploy Palm Villa to Cloudflare** from the repository's **Actions** tab for the first deployment. The workflow builds the allowlisted frontend, applies D1 migrations, then deploys the Worker. Later pushes to `main` deploy automatically.
5. After a successful deploy, open the Worker’s `workers.dev` URL and sign in at `/login.html`. The manager dashboard is `/index.html`; staff use `/orders.html`. Change the initial manager password, then delete the `MANAGER_PASSWORD` secret. Import the old browser export at `/migration.html` and check customers, debts, menu prices, and reports before staff use the new address.
6. If you own a domain in Cloudflare, add it under the Worker’s **Settings > Domains & Routes > Add > Custom Domain**. Cloudflare provisions DNS and HTTPS for the Worker. Use this stable HTTPS address for staff and QR codes.

Keep preview deployments disabled until a separate preview D1 database and preview secrets are configured; otherwise a preview could use production data. Keep `SESSION_SECRET` unchanged so existing sessions remain valid. D1 Time Travel provides point-in-time recovery for the account plan’s retention window (7 days on Free, 30 days on Paid); periodically export a separate copy for recovery beyond that window. Check current Cloudflare plan limits and pricing before relying on the service for business operations.

Cloudflare references: [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/), [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/), [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## Node host with persistent storage

## Existing Node setup: Render + GitHub

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
