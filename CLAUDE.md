# Frontend — application comptable (V1)

Frontend Angular de l'application comptable Alco Consulting (multi-sociétés, OHADA). Le
backend Django est terminé et en production (`https://api.alcoconsulting.tech`, voir
`../backend/CLAUDE.md`).

**État actuel : phase UX/UI 0 (design system, App Launcher de 6 applications, coquille des
modules), Module 0 (socle technique), Module 1 (authentification), Module 2 (société active
et App Launcher réels), Module 3 (Tiers) et Module 4 (socle de la Comptabilité : tableau
de bord, journaux, plan comptable, exercices et périodes) livrés.**
Le socle parle à l'API Django : environnements, `ApiClient`, intercepteurs (session, CSRF,
`X-Company-ID`, erreurs, chargement), gardes. Connexion et déconnexion réelles ; utilisateur,
sociétés accessibles, société active, permissions et lanceur viennent de l'API (plus de
session simulée). L'application Tiers est réelle (liste, recherche, filtres, fiche,
création, modification, désactivation, import et export contextuels). Comptabilité : tableau
de bord, journaux, plan comptable, exercices et périodes sont réels ; les Écritures restent
l'écran de démonstration du prototype (bandeau « Écran de démonstration »).
Architecture technique : `../docs/frontend/technical-architecture.md`. Prochaine étape : les
modules métier un par un (chacun remplace ses écrans de démonstration).

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
| Serveur de dev (vraie session, via proxy, votre compte) | `npm start` → <http://localhost:4200> (cible : `ALCO_API_TARGET`, défaut API déployée) |
| Lint | `npm run lint` (ESLint + Stylelint + Prettier `--check`) ; corriger le format : `npm run format` |
| Tests unitaires | `npm test` (Vitest via `ng test`, jsdom) |
| Build | `npm run build` (production, budgets actifs) |
| E2E | `npm run e2e` (Playwright : bureau + tablette + téléphone, faux serveur `e2e/support/fake-api.ts`, axe-core) |
| Captures de revue | `npm run captures` → `../docs/frontend/captures/` |

Sur ce poste, le Chromium de Playwright n'est pas installé : préfixer par
`PLAYWRIGHT_CHANNEL=chrome` (Chrome du système). Lancer les e2e avec `--workers=2` au plus
(au-delà, la machine manque de ressources : `ERR_INSUFFICIENT_RESOURCES`).

Après chaque module : **lint + tests + build + e2e**, tous verts. Ne jamais désactiver un test.

## Architecture

```text
src/styles/     _tokens (seul endroit des valeurs brutes) · _breakpoints · _base · _forms · _overlays
src/app/
  environments/ environment.ts (→ .production) · .development · .testing
  core/         config (APP_CONFIG) · http (ApiConfig, ApiClient, ApiError, intercepteurs,
                CsrfToken, LoadingService, requestState) · auth (AuthApi, SessionService,
                gardes) · company (CompanyApi, CompanyContextService : ouverture, choix,
                changement, refus, société par défaut) ·
                layout (company-scope, module-shell, topbar, logo, not-found) · navigation (applications.ts =
                catalogue des applications, de leurs menus et de leurs sections ;
                NavigationService = une seule règle de visibilité permissions + domaines
                utilisés par la société ; gardes appAccess/screenAccess ; fil d'Ariane et
                titre d'onglet) · session (SessionStore : utilisateur, sociétés, société
                active, permissions, features) · errors (code API → message humain) ·
                notifications
  shared/       ui · forms · filters · tables · pipes · utils — composants de présentation
  features/     launcher · auth (écran de connexion) · company-choice (`/societe`) ·
                partners (Tiers : data-access, pages, présentation, routes) · accounting
                (socle comptable : data-access, dashboard, journals, accounts, periods) · transfers
                (import/export contextuels, sans route propre) · design-system · prototype
  app.routes.ts `/` → `/app` (lanceur, zone authentifiée dans AlcoCompanyScope),
                `/app/<application>/…`, `/login`, `/societe`, `/design-system` ; une coquille
                AlcoModuleShell par application
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
10. **Contexte société** : la société active, la liste des sociétés et les permissions
    viennent de `company-context/` (seul `CompanyContextService` écrit ce contexte). Une donnée
    d'une société ne se garde que dans un écran (recréé au changement de société par
    `AlcoCompanyScope`) ou dans un service vidé sur `CompanyContextService.changed$`. Seules
    les permissions globales `users.*` et `companies.create` de `auth/me/` comptent hors
    société (`isGlobalPermission`, règle du backend). Une section peut aussi dépendre d'un
    domaine utilisé par la société (`feature`) ; le backend ne l'expose pas encore
    (`features = null` : rien de masqué pour cette raison).
11. **HTTP** : un service de domaine passe par `ApiClient` (chemins relatifs à l'API), jamais
    par une URL écrite en dur ; il n'écrit jamais `X-Company-ID`, `X-XSRF-TOKEN` ni cookie
    (intercepteurs) ; il reçoit une `ApiError` et l'affiche avec `toUserError`. Pas de JWT, pas
    de jeton en stockage local. Un 403 n'est une fin de session que s'il vaut
    `not_authenticated` (DRF, authentification de session). Tout nouveau service HTTP est
    testé avec `HttpTestingController` : aucun test n'appelle l'API réelle.
12. Gardes et fonctions asynchrones : tout `inject()` **avant** le premier `await` (hors
    contexte d'injection ensuite). Une destination qui dépend des permissions est une garde,
    jamais un `redirectTo` (calculé avant les gardes, donc avant le chargement de la session).
13. Accessibilité : libellés, focus visible, clavier complet, pas d'information par la
    couleur seule ; axe-core doit rester sans violation.
14. Code, identifiants et commentaires en anglais ; textes d'interface et documentation en
    français (apostrophe typographique ’ et guillemets « »).

## Prototype (à retirer progressivement)

`features/prototype/` : écrans métier de démonstration — faux serveur en mémoire
(`PrototypeAccountingApi`, latence simulée, codes d'erreur réels du backend, **une série de
données par société active**, comme `X-Company-ID`), données fictives marquées « (démo) »,
écrans non construits (`NotInPrototypePage`), liste des tiers (`partners/`), import/export
contextuels (`transfers/` : types calqués sur l'API V1). Les écrans à données fictives portent
`data: { demo: true }` : le bandeau « Écran de démonstration » (`prototype-banner.ts`, affiché
par `app.ts`) n'apparaît que sur eux. Branché dans `app.routes.ts` (`APPLICATION_ROUTES`).
Plus de session, de profil ni de société simulés (Module 2) : tout le contexte vient de l'API.
Quand un module métier arrive : il remplace ses routes de prototype et ses données, puis on
supprime ce qui ne sert plus.

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
- **Plus de session simulée** (Module 2) : `sessionSource` et la configuration
  `development-api` sont supprimés ; `npm start` = API par le proxy. Les e2e répondent à l'API
  eux-mêmes (`e2e/support/fake-api.ts`, sociétés « (test) »).
- **Société active** : `company-context/` (société par défaut ; une seule société → elle ;
  sinon choix sur `/societe`, avec `PUT company-context/default/` en option). Choix de
  l'onglet dans `sessionStorage` (`alco.company`, identifiant revérifié par le serveur).
  Changement : `SessionStore.activity = 'switching-company'` → `AlcoCompanyScope` retire les
  écrans, contexte rechargé, atterrissage `NavigationService.landingUrl()` (même écran du menu
  si permis, jamais une fiche), écrans recréés. `company_access_denied` (même réponse pour
  inconnue, inaccessible, désactivée) : liste rafraîchie, message, société valide.
- **Tiers (Module 3)** : `features/partners` sur `partners/` ; liste = colonnes de
  `PartnersPartnerSummary` (pas de téléphone/e-mail : pas de requête par ligne) ; recherche,
  filtres (État, Rôle, Pays) et pages du serveur ; pas de tri ni de regroupement (non offerts
  par l'API) ; création = champs du contrat ; modification = champs changés seulement, jamais
  le code ; pas de suppression (désactivation). Fiche nommée dans le fil d'Ariane par
  `BreadcrumbService.nameCurrent` (pas de resolver).
- **Comptabilité, socle (Module 4)** : `features/accounting` sur `accounting/` ; pas
  d'endpoint de tableau de bord comptable → blocs indépendants assemblés depuis l'API (7
  requêtes fixes, aucun N+1, aucun calcul : `count` du serveur, `postable` du serveur) ;
  exercice affiché = exercices `status=open` du serveur ; exercices et périodes en lecture
  seule ; journaux sans recherche texte (l'API n'en a pas) ; hiérarchie des comptes par
  `parent` / `children/` (pas d'arbre reconstruit : aucun filtre « racines ») ; parent saisi
  par code et résolu par `?code=` ; classe saisie, jamais déduite.
- **Import/export réels** : `features/transfers` (API `imports-exports/`, écran d'import par
  étapes, « Actions ▾ » `AlcoDomainTransfers`). Un domaine décrit les siens
  (`ContextualTransfer`) ; aucun écran générique. L'import des écritures reste celui du
  prototype jusqu'au module Comptabilité.
- **Paramètres** n'a pas de permission propre : visible dès qu'un de ses écrans l'est
  (`companies.read`, `users.read`, `companies.manage_members`, `currencies.read`).
- **CSRF** : l'intercepteur intégré d'Angular est remplacé (`withNoXsrfProtection`) par
  `csrfInterceptor` (mêmes noms, même règle d'origine, + récupération du cookie et une
  nouvelle tentative après `csrf_failed`). La protection reste active côté serveur.
- **Connexion** : contrat `backend/docs/api/openapi.yaml` (`UsersLoginRequest` =
  `{email, password}`) ; la réponse est l'utilisateur (pas de second `auth/me/`) ;
  `invalid_credentials` couvre aussi le compte désactivé (choix du backend) ; 429 +
  `Retry-After` → compte à rebours, aucun limiteur côté Angular ; retour après connexion par
  `safeReturnUrl()` (seulement `/app…`). Pas de « se souvenir de moi », pas de faux « mot de
  passe oublié ».
- **Un seul store de session** : `SessionStore` (statut, activité, erreur, utilisateur,
  sociétés, permissions) ; `SessionService` seul écrivain ; `ended$` pour vider les caches.
- **Délai des requêtes** : `timeout({ each })` et non `first` (le premier événement « envoyé »
  arrive tout de suite).
- `environment.testing.ts` (et non `.test.ts`, que Vitest prendrait pour un fichier de tests) ;
  `environment.ts` réexporte `environment.production.ts`, pour que les tests lisent les vraies
  valeurs de production.
- **Déploiement** : recommandé en même origine que l'API (reverse proxy) ; une autre origine
  exigerait des réglages backend (CORS avec identifiants, cookie CSRF lisible) — à décider.
  En dev, proxy Angular (`proxy.conf.mjs`) ; `http://localhost:4200` est autorisé côté serveur.

## TODO

- Changement de mot de passe (`POST auth/password/change/` existe) ; réinitialisation par
  e-mail quand le backend l'exposera ; fin du mode prototype (quand les modules métier
  remplaceront les données fictives).
- Décider l'origine du frontend en production (technical-architecture.md § 12).
- Exercice dans la barre supérieure et le lanceur (aujourd'hui sur le tableau de bord
  comptable seulement).
- Comptabilité : créer, clôturer, rouvrir exercices et périodes (`manage_periods`, avec la
  clôture) ; « Paramètres comptables » (`accounting/settings/`) ; Écritures réelles (module
  suivant).
- Tiers : écran « Conditions de paiement » (API complète : liste, création, modification,
  désactivation) ; rapport d'import paginé au-delà de 50 lignes refusées ; export asynchrone
  pour les gros volumes.
- Domaines utilisés par société (`features`) : à exposer par le backend (puis écran
  Paramètres) avant de masquer quoi que ce soit pour cette raison.
- Actions GitHub `checkout`/`setup-node` v4 → v5 (Node 20 déprécié) ; `ubuntu-latest` passe
  à Ubuntu 26 le 19/10/2026.
- `AlcoDrawer` (non construit, pas d'usage) ; mode sombre (tokens prêts à être redéfinis).
- Garde « modifications non enregistrées » sur les formulaires (aussi avant un changement de
  société : aujourd'hui, un formulaire en cours est abandonné sans question).
- Regroupement côté serveur (le prototype regroupe la page courante) et sous-totaux fournis
  par l'API.
- Graphiques du tableau de bord (charger la compétence dataviz avant d'en dessiner).
- Imports/exports non proposés par l'API V1 : décision métier puis backend.
