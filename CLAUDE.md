# Frontend — application comptable (V1)

Frontend Angular de l'application comptable Alco Consulting (multi-sociétés, OHADA). Le
backend Django est terminé et en production (`https://api.alcoconsulting.tech`, voir
`../backend/CLAUDE.md`).

**État actuel : phase UX/UI 0 livrée** — design system, App Launcher, coquille des modules
(barre supérieure + navigation horizontale + fil d'Ariane) et prototype de navigation
Comptabilité (tableau de bord, liste et formulaire d'écritures) sur **données fictives**.
Aucune authentification, aucun appel HTTP, aucun module métier. Prochaine étape : Module 0
(socle Angular : HttpClient, intercepteurs, environnements, proxy vers l'API), puis
auth + contexte société (F2), puis les modules métier un par un.

Sources : le guide de conception frontend (`../docs/Guide_Conception_Frontend_*.docx`) fixe
l'ordre des modules et les règles techniques ; la phase UX/UI 0 du superviseur fixe
l'expérience utilisateur et **prime sur le guide pour la navigation** (lanceur + navigation
horizontale, aucune sidebar : la section 6 du guide est remplacée). Documentation de
référence : `../docs/frontend/design-system.md` et `../docs/frontend/ux-guidelines.md`.
Ne jamais indexer les `.docx` de `../docs/` dans git.

## Commandes (depuis `frontend/`)

| Action | Commande |
| --- | --- |
| Installer | `npm ci` (`.npmrc` : `legacy-peer-deps`, voir Décisions) |
| Serveur de dev | `npm start` → <http://localhost:4200> |
| Lint | `npm run lint` (ESLint + Stylelint + Prettier `--check`) ; corriger le format : `npm run format` |
| Tests unitaires | `npm test` (Vitest via `ng test`, jsdom) |
| Build | `npm run build` (production, budgets actifs) |
| E2E | `npm run e2e` (Playwright : desktop + tablette + téléphone, axe-core) |
| Captures de revue | `npm run captures` → `../docs/frontend/captures/` |

Sur ce poste, le Chromium de Playwright n'est pas installé : préfixer par
`PLAYWRIGHT_CHANNEL=chrome` (Chrome du système). Lancer les e2e avec `--workers=2` au plus
(au-delà, la machine manque de ressources : `ERR_INSUFFICIENT_RESOURCES`).

Après chaque module : **lint + tests + build + e2e**, tous verts. Ne jamais désactiver un test.

## Architecture

```text
src/styles/     _tokens (seul endroit des valeurs brutes) · _breakpoints · _base · _forms · _overlays
src/app/
  core/         layout (module-shell, topbar, logo, not-found) · navigation (applications.ts =
                catalogue des applications et de leurs menus, garde d'accès, fil d'Ariane et
                titre d'onglet) · session (utilisateur, société active, permissions) · errors
                (code API → message humain) · notifications
  shared/       ui · forms · filters · tables · pipes · utils — composants de présentation
  features/     launcher · design-system (catalogue /design-system) · prototype (PROTOTYPE UX 0)
  app.routes.ts lanceur à la racine ; une coquille AlcoModuleShell par application (data.appId)
```

Sens des dépendances, vérifié par ESLint (`no-restricted-imports`) : `shared` n'importe ni
`core` ni `features` ; `core` n'importe aucune feature ; seuls `app.*` composent le tout.

## Règles

1. Inspecter le dépôt avant de modifier ; rester dans le périmètre du module demandé.
2. Standalone components, `ChangeDetectionStrategy.OnPush`, entrées/sorties en signaux
   (`input`, `model`, `output`), control flow `@if/@for`, TypeScript strict, pas de `any`,
   pas de `!` non justifié.
3. **Design system obligatoire** : réutiliser les composants de `shared/` (liste dans
   design-system.md) ; ne pas recréer un bouton, un tableau, un dialogue. Aucune couleur hors
   tokens (Stylelint bloque) ; pas de nouvelle taille de police.
4. **Aucune règle métier dans un composant.** Le frontend affiche l'état et les actions que
   l'API autorise ; il ne décide jamais d'une transition ; il ne calcule jamais un résultat
   comptable. Montants = chaînes décimales (`shared/utils/decimal.ts`, BigInt, sans arrondi).
5. Permissions : l'UI masque ce qui n'est pas permis (confort) ; l'API reste l'autorité.
   Codes de permission du backend (`<domaine>.read`, `accounting.create`…).
6. Erreurs : messages indexés par le `code` stable de l'API (jamais son `message`),
   via `toUserError(erreur, catalogueDeLaFeature)` ; code et référence seulement dans
   « Détails techniques ».
7. Chaque écran gère chargement (squelette local), vide (message + action selon les droits),
   erreur (humaine, réessayer) et interdit.
8. UX non négociable : aucune sidebar globale ; navigation de module ≤ 7 entrées, le reste
   dans des menus ; une action principale par écran, les autres dans « Actions ▾ » ;
   confirmation des actions sensibles ; modales rares ; pas de défilement horizontal de page.
9. Accessibilité : libellés, focus visible, clavier complet, pas d'information par la couleur
   seule ; axe-core doit rester sans violation.
10. Code, identifiants et commentaires en anglais ; textes d'interface et documentation en
    français (apostrophe typographique ’ et guillemets « »).

## Prototype (à retirer progressivement)

`features/prototype/` : faux serveur en mémoire (`PrototypeAccountingApi`, latence simulée,
codes d'erreur réels du backend), données fictives marquées « (démo) », profil simulé
(`PrototypeSession`, sélecteur dans le bandeau, conservé en `sessionStorage`), écrans non
construits (`NotInPrototypePage`). Branché dans `app.config.ts` (`providePrototypeSession`)
et `app.routes.ts` (`placeholderApplication`). Quand un module métier arrive : il remplace
ses routes de prototype et ses données, puis on supprime ce qui ne sert plus. En F2, la
session vient de l'API et le bandeau disparaît.

## Décisions

- **Angular 21 (LTS)** et non 22 : Angular 22 exige Node ≥ 24.15, le poste a 24.13.1.
  Migrer par `ng update` après mise à jour de Node.
- **`.npmrc` `legacy-peer-deps=true`** : npm 11 plante (« edgesOut ») en résolvant les pairs
  optionnels de Vitest 4 (il choisit `@vitest/browser-playwright` 5). Toutes les dépendances
  utiles sont déclarées explicitement.
- **CDK Angular** (menus, dialogues, superpositions, piège de focus) plutôt qu'une
  bibliothèque de composants : accessibilité éprouvée, apparence 100 % Alco.
- **Police Inter auto-hébergée** (`@fontsource-variable/inter`) : aucune requête externe.
- **État des listes dans l'URL** (`?etat=…&groupe=…&tri=…&page=…`) : retour arrière et
  partage fonctionnent.
- Fil d'Ariane et titre d'onglet déduits des routes (`data.breadcrumb`, `resolve.breadcrumb`).
- Déploiement du frontend : même site que l'API (cookies de session + CSRF `XSRF-TOKEN`,
  voir backend) — à trancher au Module 0 ; en dev, proxy Angular vers l'API
  (origine `http://localhost:4200` déjà autorisée côté serveur).

## TODO

- Module 0 : HttpClient + `withXsrfConfiguration`, intercepteur d'erreurs vers
  `toUserError`, `X-Company-ID`, environnements, `proxy.conf.json`.
- `AlcoDrawer` (non construit, pas d'usage) ; mode sombre (tokens prêts à être redéfinis).
- Garde « modifications non enregistrées » sur les formulaires.
- Regroupement côté serveur (le prototype regroupe la page courante) et sous-totaux fournis
  par l'API.
- Graphiques du tableau de bord (charger la compétence dataviz avant d'en dessiner).
