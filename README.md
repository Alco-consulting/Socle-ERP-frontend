# Frontend — application comptable Alco

Angular 21 (standalone, signaux, zoneless, TypeScript strict). État actuel : **phase UX/UI 0**
— design system, App Launcher, coquille des modules et prototype de navigation sur données
fictives. Aucun module métier, aucun appel à l'API.

Documentation : [`../docs/frontend/design-system.md`](../docs/frontend/design-system.md),
[`../docs/frontend/ux-guidelines.md`](../docs/frontend/ux-guidelines.md), règles de travail
dans [`CLAUDE.md`](CLAUDE.md).

| Action | Commande |
| --- | --- |
| Installer (Node ≥ 22.12 ou ≥ 24) | `npm ci` |
| Lancer (<http://localhost:4200>) | `npm start` |
| Lint (ESLint, Stylelint, Prettier) | `npm run lint` |
| Tests unitaires (Vitest) | `npm test` |
| Build de production | `npm run build` |
| Tests e2e (Playwright) | `npx playwright install chromium` une fois, puis `npm run e2e` |
| Captures de validation | `npm run captures` (écrit dans `../docs/frontend/captures/`) |

Sous Windows sans le Chromium de Playwright : `PLAYWRIGHT_CHANNEL=chrome` réutilise le Chrome
installé (PowerShell : `$env:PLAYWRIGHT_CHANNEL='chrome'; npm run e2e`).
