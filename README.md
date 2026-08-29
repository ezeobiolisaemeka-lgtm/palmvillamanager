# Palm Villa POS

A lightweight, installable Progressive Web App (PWA) for Palm Villa — staff order entry (`orders.html`) and manager dashboard (`index.html`). Built with vanilla HTML, CSS and JavaScript and persisting data in `localStorage`.

## Features
- Staff order entry optimized for mobile
- Per-customer carts and order history
- Manager dashboard with staff activity and sales history
- PWA support (manifest + service worker) and app icons
- Simple static site — ready to host on GitHub Pages, Netlify, or Vercel

## Run locally
Start a quick local server for testing:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
# then open http://localhost:8000/orders.html or http://<your-ip>:8000/orders.html
```

## Prepare GitHub repository and push
1. Create a new repository on GitHub (e.g. `palmvillamanager`).
2. From your project folder, run:

```bash
git init
git add .
git commit -m "Initial Palm Villa POS"
# create remote repo on GitHub and paste the URL below
git remote add origin https://github.com/<yourname>/palmvillamanager.git
git branch -M main
git push -u origin main
```

This repository already includes a GitHub Actions workflow that will build/publish the `main` branch to the `gh-pages` branch and serve the site via GitHub Pages.

## GitHub Pages deployment (already configured)
A workflow file `.github/workflows/gh-pages.yml` is included — when you push to `main` the workflow will publish the repository root to `gh-pages` using `peaceiris/actions-gh-pages`. After the workflow finishes, enable GitHub Pages in the repository settings (branch: `gh-pages`, folder: `/`) if not automatically configured.

## If you prefer Netlify or Vercel
See `README_DEPLOY.md` for one-line commands and CLI deploy scripts.

## Notes for hosting
- Keep `palmVillaData` and `palmVillaCustomers` in `localStorage` — migrating to a server DB is a future improvement.
- If you want me to push to GitHub for you, provide the remote repo URL or let me create a repo (requires your permission/access).

