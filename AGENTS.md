# Repository Guidelines

## Project Structure

This is a static, installable Palm Villa POS built with vanilla HTML, CSS, and JavaScript. The manager dashboard is `index.html`; staff order entry is `orders.html`; `script.js` contains shared application logic, and `style.css` contains the styles. PWA metadata and offline behavior live in `manifest.json`, `sw.js`, and the root logo assets. Deployment automation is under `.github/workflows/`. There is no separate source or test directory.

## Build, Run, and Development

There is no build step or package manager configuration. Run the site locally with:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Open `http://localhost:8000/orders.html` or `http://localhost:8000/index.html`. Use a local HTTP server when checking service worker or installable PWA behavior. GitHub Actions publishes the static site from `main` to GitHub Pages; deployment details are in `README_DEPLOY.md`.

## Code and Data Conventions

Keep changes compatible with plain browser JavaScript; do not add a framework or build dependency without updating the project documentation and deployment workflow. Use two spaces for indentation, descriptive camelCase names for JavaScript variables and functions, and lowercase kebab-case for new asset filenames. Keep the existing page, stylesheet, and script separation. Order and customer records are stored in browser `localStorage`; preserve the established keys (`palmVillaData` and `palmVillaCustomers`) and consider existing stored data when changing their shape.

Menu prices belong in the `menuPrices` object near the top of `script.js`. Both pages display and charge from this object; keep item names consistent when adding menu items.

## Testing Guidelines

No automated test framework or coverage threshold is configured. For UI changes, manually check affected pages in a browser, including mobile-sized layouts when relevant. For data or offline changes, verify order entry, dashboard behavior, and service worker updates with a clean or representative browser storage state.

## Commits and Pull Requests

Recent commits use short, imperative subjects with a category prefix, such as `feat: modernize Palm Villa POS` and `ci: add Pages permissions`. Follow that pattern (`fix: ...`, `feat: ...`, `docs: ...`). Pull requests should summarize user-visible changes, list manual checks performed, link related issues when available, and include screenshots for visual changes.

## Configuration and Sensitive Data

Do not commit credentials, customer exports, or local environment files. Keep secrets out of the static site: files published from the repository root are publicly accessible.
