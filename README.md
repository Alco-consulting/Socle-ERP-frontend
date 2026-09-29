# Frontend — application comptable Alco

Angular 21 (standalone, signaux, zoneless, TypeScript strict). État actuel : **UX/UI 0**
(design system, App Launcher, coquille des modules, prototype sur données fictives) et
**Module 0** (socle technique : API, session Django, CSRF, contexte société). Aucun module
métier.

Documentation : [`../docs/frontend/design-system.md`](../docs/frontend/design-system.md),
[`../docs/frontend/ux-guidelines.md`](../docs/frontend/ux-guidelines.md),
[`../docs/frontend/technical-architecture.md`](../docs/frontend/technical-architecture.md), règles de travail
dans [`CLAUDE.md`](CLAUDE.md).

| Action | Commande |
| --- | --- |
| Installer (Node ≥ 22.12 ou ≥ 24) | `npm ci` |
| Lancer le prototype (<http://localhost:4200>) | `npm start` |
| Lancer contre l'API (vraie session, proxy) | `npm run start:api` |
| Lint (ESLint, Stylelint, Prettier) | `npm run lint` |
| Tests unitaires (Vitest) | `npm test` |
| Build de production | `npm run build` |
| Tests e2e (Playwright) | `npx playwright install chromium` une fois, puis `npm run e2e` |
| Captures de validation | `npm run captures` (écrit dans `../docs/frontend/captures/`) |

Sous Windows sans le Chromium de Playwright : `PLAYWRIGHT_CHANNEL=chrome` réutilise le Chrome
installé (PowerShell : `$env:PLAYWRIGHT_CHANNEL='chrome'; npm run e2e`).
