# Frontend — application comptable (V1)

Frontend Angular de l'application comptable Alco Consulting (multi-sociétés, OHADA). Le
backend Django est terminé et en production (`https://api.alcoconsulting.tech`, voir
`../backend/CLAUDE.md`).

**État actuel : phase UX/UI 0 (design system, App Launcher de 6 applications, coquille des
modules, prototype Comptabilité sur données fictives) et Module 0 (socle technique) livrés.**
Le socle parle à l'API Django : environnements, `ApiClient`, intercepteurs (session, CSRF,
`X-Company-ID`, erreurs, chargement), session et contexte société, gardes. Aucun écran
métier n'appelle encore l'API ; l'écran de connexion est provisoire.
Architecture technique : `../docs/frontend/technical-architecture.md`. Prochaine étape : Module 0
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
| Serveur de dev (prototype, session simulée) | `npm start` → <http://localhost:4200> |
| Serveur de dev contre l'API (vraie session, via proxy) | `npm run start:api` (cible : `ALCO_API_TARGET`, défaut API déployée) |
| Lint | `npm run lint` (ESLint + Stylelint + Prettier `--check`) ; corriger le format : `npm run format` |
| Tests unitaires | `npm test` (Vitest via `ng test`, jsdom) |
| Build | `npm run build` (production, budgets actifs) |
| E2E | `npm run e2e` (Playwright : bureau + tablette + téléphone + mode API à réseau simulé, axe-core) |
| Captures de revue | `npm run captures` → `../docs/frontend/captures/` |

Sur ce poste, le Chromium de Playwright n'est pas installé : préfixer par
`PLAYWRIGHT_CHANNEL=chrome` (Chrome du système). Lancer les e2e avec `--workers=2` au plus
(au-delà, la machine manque de ressources : `ERR_INSUFFICIENT_RESOURCES`).

Après chaque module : **lint + tests + build + e2e**, tous verts. Ne jamais désactiver un test.

## Architecture

```text
src/styles/     _tokens (seul endroit des valeurs brutes) · _breakpoints · _base · _forms · _overlays
src/app/
  environments/ environment.ts (→ .production) · .development · .development-api · .testing
  core/         config (APP_CONFIG) · http (ApiConfig, ApiClient, ApiError, intercepteurs,
                CsrfToken, LoadingService, requestState) · auth (AuthApi, SessionService,
                gardes) · company (CompanyApi, CompanyContextService) ·
                layout (module-shell, topbar, logo, not-found) · navigation (applications.ts =
                catalogue des applications, de leurs menus et de leurs sections ;
                NavigationService = une seule règle de visibilité permissions + domaines
                utilisés par la société ; gardes appAccess/screenAccess ; fil d'Ariane et
                titre d'onglet) · session (utilisateur, société active, permissions,
                features) · errors (code API → message humain) · notifications
  shared/       ui · forms · filters · tables · pipes · utils — composants de présentation
  features/     launcher · auth (écran de connexion provisoire) · design-system · prototype
  app.routes.ts `/` → `/app` (lanceur, zone authentifiée), `/app/<application>/…`, `/login`,
                `/design-system` ; une coquille AlcoModuleShell par application
                (features/prototype/prototype-routes.ts : écrans construits + écrans prévus
                et sections générés depuis le catalogue)
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
8. UX non négociable : aucune sidebar globale (même pour gagner de la place) ; navigation de
   module ≤ 6 liens directs + 3 menus ; une action principale par écran, les autres dans
   « Actions ▾ » ; confirmation des actions sensibles ; modales rares ; pas de défilement
   horizontal de page.
9. **Regroupement des modules** : les domaines financiers spécialisés (trésorerie,
   immobilisations, emprunts, taxes, analytique et audit) sont des sous-domaines de
   l'application Comptabilité et ne constituent pas des applications principales du
   launcher. Import/Export est une capacité contextuelle de chaque domaine et ne constitue pas
   une application indépendante (ni tuile, ni menu, ni route, ni écran générique) : chaque
   domaine a son « Actions ▾ » avec exactement son import/export, et seulement ce que l'API
   propose (V1 : import écritures et tiers ; export tiers, balance, grand livre).
10. Une section peut être optionnelle pour une société (`feature` : treasury, assets, loans,
    taxes, analytics) : masquée dans les menus, fermée par son URL (`screenAccessGuard`).
    La configuration réelle par société n'existe pas encore (simulée par le prototype).
11. **HTTP** : un service de domaine passe par `ApiClient` (chemins relatifs à l'API), jamais
    par une URL écrite en dur ; il n'écrit jamais `X-Company-ID`, `X-XSRF-TOKEN` ni cookie
    (intercepteurs) ; il reçoit une `ApiError` et l'affiche avec `toUserError`. Pas de JWT, pas
    de jeton en stockage local. Un 403 n'est une fin de session que s'il vaut
    `not_authenticated` (DRF, authentification de session). Tout nouveau service HTTP est
    testé avec `HttpTestingController` : aucun test n'appelle l'API réelle.
12. Gardes et fonctions asynchrones : tout `inject()` **avant** le premier `await` (hors
    contexte d'injection ensuite).
13. Accessibilité : libellés, focus visible, clavier complet, pas d'information par la
    couleur seule ; axe-core doit rester sans violation.
14. Code, identifiants et commentaires en anglais ; textes d'interface et documentation en
    français (apostrophe typographique ’ et guillemets « »).

## Prototype (à retirer progressivement)

`features/prototype/` : faux serveur en mémoire (`PrototypeAccountingApi`, latence simulée,
codes d'erreur réels du backend), données fictives marquées « (démo) », profil simulé
(`PrototypeSession`, sélecteur dans le bandeau) et société simulée (deux sociétés, dont une
de services sans immobilisations/emprunts/analytique), tous deux conservés en
`sessionStorage` ; écrans non construits (`NotInPrototypePage`) ; liste des tiers
(`partners/`) ; import/export contextuels (`transfers/` : types calqués sur l'API V1, écran
« Import d'écritures / de tiers », confirmation d'export). Branché dans `app.config.ts`
(`providePrototypeSession`, seulement quand `sessionSource === 'prototype'`) et
`app.routes.ts` (`APPLICATION_ROUTES`). Le mode API (`npm run start:api`) désactive la session
simulée et le bandeau ; les écrans du prototype y restent sur données fictives. Quand un module métier arrive : il remplace
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
- **Six applications** (Comptabilité, Tiers, Reporting, Documents, Tableau de bord,
  Paramètres) ; Comptabilité porte Tiers (suivi comptable), Trésorerie en liens directs, puis
  Immobilisations, Emprunts, Taxes, Analytique, Audit, Clôture sous « Plus ▾ ». L'application
  Tiers gère les fiches ; Comptabilité › Tiers suit soldes, échéances, lettrage.
- Opérations d'import/export absentes de l'API V1 (export des écritures, immobilisations,
  opérations de trésorerie) : affichées désactivées avec leur raison — **à valider** (les
  masquer ou les ajouter au backend).
- Navigation compacte tablette par CSS (trois gabarits rendus, un seul visible), sans mesure
  JavaScript de la largeur.
- **Session Django uniquement** (cookie HttpOnly), `SessionService` : un seul appel
  `auth/me/` + `company-context/` ; fin de session = 403 `not_authenticated` → une seule
  navigation vers `/login?raison=session-expiree&retour=…`.
- **CSRF** : l'intercepteur intégré d'Angular est remplacé (`withNoXsrfProtection`) par
  `csrfInterceptor` (mêmes noms, même règle d'origine, + récupération du cookie et une
  nouvelle tentative après `csrf_failed`). La protection reste active côté serveur.
- **Délai des requêtes** : `timeout({ each })` et non `first` (le premier événement « envoyé »
  arrive tout de suite).
- `environment.testing.ts` (et non `.test.ts`, que Vitest prendrait pour un fichier de tests) ;
  `environment.ts` réexporte `environment.production.ts`, pour que les tests lisent les vraies
  valeurs de production.
- **Déploiement** : recommandé en même origine que l'API (reverse proxy) ; une autre origine
  exigerait des réglages backend (CORS avec identifiants, cookie CSRF lisible) — à décider.
  En dev, proxy Angular (`proxy.conf.mjs`) ; `http://localhost:4200` est autorisé côté serveur.

## TODO

- Module Authentification : formulaire de connexion (`AuthApi.login` puis
  `SessionService.restart()`), changement de mot de passe, fin du mode prototype.
- Décider l'origine du frontend en production (technical-architecture.md § 12).
- `AlcoDrawer` (non construit, pas d'usage) ; mode sombre (tokens prêts à être redéfinis).
- Garde « modifications non enregistrées » sur les formulaires.
- Regroupement côté serveur (le prototype regroupe la page courante) et sous-totaux fournis
  par l'API.
- Graphiques du tableau de bord (charger la compétence dataviz avant d'en dessiner).
- Configuration réelle des domaines utilisés par société (backend + écran Paramètres).
- Imports/exports non proposés par l'API V1 : décision métier puis backend.
