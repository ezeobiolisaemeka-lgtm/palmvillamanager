# Palm Villa POS — Deployment Guide

This repository contains a static site (HTML/CSS/JS) suitable for static hosting.

Quick options to host it publicly:

1) Netlify — easiest (drag & drop)
- Create a free account at https://app.netlify.com/
- In the Netlify dashboard, use "Sites > New site from Git" to connect your GitHub repository, or use the drag-and-drop deploy: open the site, go to "Sites", then drag the contents of this folder (the built site) into the browser to deploy.

Netlify CLI (for terminal deploy):
```bash
npm install -g netlify-cli
# login once interactively
netlify login
# deploy the current folder as a draft
netlify deploy --dir=. 
# when you're ready to publish to a production URL
netlify deploy --prod --dir=.
```

2) GitHub Pages (via `gh-pages` branch)
- Create a GitHub repository and push this project.
- From your local repo:
```bash
git init
git add .
git commit -m "Initial site"
git branch -M main
# create repo on GitHub, then push
git remote add origin https://github.com/<yourname>/<repo>.git
git push -u origin main
# optional: publish via gh-pages branch using npm package
npm install -g gh-pages
# deploy build (here site is already static at repository root)
gh-pages -d .
```
- Or use GitHub Actions to publish `main` to GitHub Pages (see example below).

3) Vercel
- `npm i -g vercel` then `vercel` and follow prompts. Vercel will detect static site and deploy.

4) VPS / DigitalOcean / Linode
- Copy files to your server, e.g. using `rsync`:
```bash
rsync -av --delete ./ username@your.server.ip:/var/www/palmvilla
# ensure nginx/apache serves that folder
```

5) Temporary public tunnel (for testing from phone over mobile data)
- Use `ngrok` (install from https://ngrok.com/):
```bash
ngrok http 8000
# you'll get a public https://... URL you can open on phone
```

GitHub Actions example (publish `main` to `gh-pages` branch):

```yaml
# .github/workflows/gh-pages.yml
name: Deploy to GitHub Pages
on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./
```

Notes & recommendations
- Use Netlify or Vercel for the fastest setup (no server management).
- Use HTTPS — Netlify/Vercel/GitHub Pages provide it automatically.
- If you want me to prepare a Git repo or add a GitHub Actions workflow, I can add the files here; you'll still need to create the remote GitHub repo and provide the remote URL to push.

Commands you might run locally to prepare and test:
```bash
# start local server
python3 -m http.server 8000 --bind 0.0.0.0
# create a zip for manual upload
zip -r palmvilla.zip . -x '*.git*' -x 'node_modules/*'
```
