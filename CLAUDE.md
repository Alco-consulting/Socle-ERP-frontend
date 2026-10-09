# Frontend — application comptable (V1)

Frontend Angular de l'application comptable Alco Consulting (multi-sociétés, OHADA). Le
backend Django est terminé et en production (`https://api.alcoconsulting.tech`, voir
`../backend/CLAUDE.md`).

**État actuel : phase UX/UI 0 (design system, App Launcher, coquille des modules), Module 0
(socle technique), Module 1 (authentification), Module 2 (société active et App Launcher
réels), Module 3 (Tiers), Module 4 (socle de la Comptabilité : tableau de bord, journaux, plan
comptable, exercices et périodes), Module 5 (Écritures comptables) et les lots V2.1 A1/A2
(navigation alignée : lanceur de 5 applications sans Reporting, Comptabilité en 3 liens + 3
menus groupés, tableau de bord comptable sur `dashboards/journals/` et `dashboards/alerts/`),
A3 (relations et smart buttons), A4 (lettrage : lignes, sélection, aperçu, lettrage manuel et
partiel, propositions, délettrage, historique), A5 (échéances, génération, recalcul, balance
âgée clients et fournisseurs, tranches) et A6 (rapprochement bancaire : lignes, propositions,
confirmation, dé-rapprochement) et le Module 6 (Trésorerie : comptes, opérations, virements,
relevés, contrôle, import des relevés) livrés.**
Le socle parle à l'API Django : environnements, `ApiClient`, intercepteurs (session, CSRF,
`X-Company-ID`, erreurs, chargement), gardes. Connexion et déconnexion réelles ; utilisateur,
sociétés accessibles, société active, permissions et lanceur viennent de l'API (plus de
session simulée). L'application Tiers est réelle (liste, recherche, filtres, fiche,
création, modification, désactivation, import et export contextuels). Comptabilité : tableau
de bord, journaux, plan comptable, exercices et périodes sont réels, ainsi que les
écritures (liste, fiche, saisie des lignes, workflow par les commandes du serveur,
contrepassation, pièces, historique, import), ainsi que le lettrage (V2.1 A4), les échéances
et la balance âgée (V2.1 A5) ; la Trésorerie est réelle (Module 6 : comptes, opérations,
virements, relevés et leur import ; rapprochement bancaire V2.1 A6). Les autres domaines de Comptabilité restent des écrans prévus.
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
                titre d'onglet ; UnsavedChangesService + unsavedChangesGuard) · session
                (SessionStore : utilisateur, sociétés, société active, permissions, features) ·
                errors (code API → message humain) · notifications
  shared/       ui · forms (dont AlcoAutocomplete : recherche serveur) · filters · tables ·
                pipes · utils — composants de présentation
  features/     relations (data-access : compteurs d'écritures d'un objet, comptes collectifs
                d'un tiers — smart buttons) · reporting (data-access et `ledger/` : le grand
                livre, compte ou tiers) ·
                launcher · auth (écran de connexion) · company-choice (`/societe`) ·
                partners (Tiers : data-access, pages, présentation, routes) · accounting
                (socle comptable : data-access, dashboard, journals, accounts, periods ;
                entries : écritures, Module 5 ; lettering : lettrage, V2.1 A4 ; dues :
                échéances, V2.1 A5) · reporting/aging (balance âgée, tranches, V2.1 A5) · dashboards (data-access : journaux et
                alertes de `dashboards/`) · treasury (data-access : opérations d'une
                écriture ; reconciliation : rapprochement bancaire, V2.1 A6) · documents (data-access) · audit (data-access, AlcoObjectHistory :
                historique d'un objet) · transfers (import/export contextuels, sans route
                propre) · design-system · prototype (écrans prévus, LEGACY_REDIRECTS)
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

`features/prototype/` : ce qui reste du prototype — écrans non construits
(`NotInPrototypePage`, routes générées depuis le catalogue) et leur « Actions ▾ »
import/export (`transfers/` : domaines encore prévus, opération absente de l'API désactivée
avec sa raison). Les écritures fictives, `PrototypeAccountingApi` et l'import simulé sont
supprimés (Module 5). Un écran à données fictives porterait `data: { demo: true }` : le
bandeau « Écran de démonstration » (`prototype-banner.ts`, affiché par `app.ts`)
n'apparaîtrait que sur lui. Branché dans `app.routes.ts` (`APPLICATION_ROUTES`).
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
- **Cinq applications (V2.1)** : Comptabilité, Tiers, Documents, Tableau de bord, Paramètres.
  **Reporting n'est plus une application** : ses rapports sont Comptabilité › Analyse (le
  domaine `reporting` du backend reste leur source ; aucun endpoint retiré). Comptabilité :
  Tableau de bord, Clients, Fournisseurs, puis Comptabilité ▾ (Écritures, Journaux, Plan
  comptable, Tiers, Trésorerie, Lettrage, Échéances, Rapprochement, Clôture), Analyse ▾
  (Rapports financiers, comptables, de tiers, Analyses) et Configuration ▾ (Général,
  Comptabilité, Banques, Paiements, Taxes, Immobilisations, Analytique, Emprunts). Les
  sections (Trésorerie, Immobilisations, Emprunts, Taxes, Analytique, Audit) gardent leur
  navigation ; leurs écrans de configuration sont aussi dans Configuration ▾.
- **Menus groupés** : `AppNavLink.group` (helper `group()` du catalogue) → `NavLink.group` →
  `DropdownItem.group` ; le dropdown rend les éléments consécutifs d'un même groupe sous un
  titre, dans un `role="group"` nommé par ce titre (`aria-labelledby`). Tablette : « Plus ▾ »
  titré « Menu · Groupe » ; téléphone : un seul menu, mêmes groupes. Menu long : défilement
  interne (`max-height`).
- **Fonction sans API** : `unavailable: '<raison>'` dans le catalogue → entrée désactivée avec
  sa raison, sans route ni écran (aucune aujourd'hui : Lettrage l'était jusqu'au lot A4). Écran
  dont l'API existe mais non construit :
  écran prévu (`NotInPrototypePage`), qui le dit. Échéances, balance âgée, journal
  centralisateur : retirés des menus (pas d'API) ; leurs anciennes URL redirigent.
- **Clients / Fournisseurs / Comptabilité › Tiers** = `partnerListScreen()` de
  `partners.routes.ts` (mêmes écrans que l'application Tiers, fiches sous
  `/app/comptabilite/<liste>/:id`) ; la création reste `/app/tiers/nouveau`.
- **Coquille chargée à la demande** : `AlcoModuleShell` (barre supérieure, menus, CDK Menu)
  est un `loadComponent` de chaque application, plus dans le bundle initial (V2.1 : 451 kB au
  lieu de 504 kB, budget 500 kB).
- **Anciennes URL** (`LEGACY_REDIRECTS`, `prototype-routes.ts`) : `/app/reporting/*` →
  `/app/comptabilite/analyse/*`, `/app/comptabilite/rapports/*` → `…/analyse/*`,
  `…/tiers/clients|fournisseurs` → `…/clients|fournisseurs`, `/app/tiers/configuration/
  conditions` → `…/configuration/conditions-paiement` ; simples redirections (la garde de la
  cible décide).
- Opérations d'import/export absentes de l'API V1 : masquées sur les domaines réels (pas
  d'« Exporter les écritures »), affichées désactivées avec leur raison sur les écrans encore
  prévus (immobilisations, opérations de trésorerie) — **à valider** (tout masquer ou les
  ajouter au backend).
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
- **Comptabilité, socle (Module 4)** : `features/accounting` sur `accounting/` ; tableau de
  bord : blocs indépendants (V2.1 : journaux et alertes de `dashboards/`, voir plus bas ;
  exercices, périodes et plan comptable d'`accounting/`), aucun N+1, aucun calcul ;
  exercice affiché = exercices `status=open` du serveur ; exercices et périodes en lecture
  seule ; journaux sans recherche texte (l'API n'en a pas) ; hiérarchie des comptes par
  `parent` / `children/` (pas d'arbre reconstruit : aucun filtre « racines ») ; parent saisi
  par code et résolu par `?code=` ; classe saisie, jamais déduite.
- **Import/export réels** : `features/transfers` (API `imports-exports/`, écran d'import par
  étapes, « Actions ▾ » `AlcoDomainTransfers`). Un domaine décrit les siens
  (`ContextualTransfer`) ; aucun écran générique. Écritures : import `accounting.entries`
  (`ENTRY_TRANSFER`), pas d'export (absent de l'API V1).
- **Tableau de bord comptable (V2.1)** : `GET dashboards/journals/?on=<jour local>` (une
  requête pour tous les journaux : compteurs par état, trésorerie liée) et `GET
  dashboards/alerts/?date_from=<début de l'exercice ouvert qui contient le jour>&date_to=<jour>`
  (pas d'appel sans tel exercice). Rien n'est reconstruit depuis d'autres endpoints ni
  calculé : compteurs → liens `/ecritures?journal=<id>&etat=<état>` ;
  `treasury_accounts: null` → aucune information de trésorerie ; alertes et indicateurs nommés
  par leur `code` (`dashboard-presentation.ts`), jamais par le `message` du serveur ; lien vers
  l'écran de leur domaine s'il s'ouvre (`NavigationService.canOpenPath`). Menu ⋮ d'une carte :
  Voir les écritures, Nouvelle écriture (`accounting.create`, `?journal=<id>`),
  Configuration du journal — pas d'« Analyse » (aucune API par journal). Permissions :
  `dashboards.read` (lien du menu) + `accounting.read` ; trésorerie :
  `dashboards.read_treasury` + `treasury.read` (le serveur décide, `restricted: ['cash']`).
  Aucune permission n'en implique une autre ; le backend n'a ni rôle ni seed de rôles (les
  permissions s'accordent par adhésion) : `dashboards.read` s'accorde explicitement aux
  comptables. Montants : précision de la devise (`currencies/`), jamais d'arrondi.
- **Smart buttons** (`AlcoSmartButton`) : fiche Journal = Écritures, Brouillons, Soumises
  (`count` de `accounting/entries/?journal=&status=&page_size=1`, 3 requêtes fixes) et
  Historique (`audit.read` : `count` de `audit/objects/accounting.journal/<id>/`, lien vers
  `#historique`). Jamais de compteur sans endpoint.
- **Relations et smart buttons (V2.1 A3)** : fiches Journal, Compte, Tiers (voir
  ux-guidelines § 5 sexies). Comptes : `RelationsApi.entryCount(status, {journal|account|
  partner})` (`count` d'une page d'une ligne) et `collectiveAccounts(partner)` ; historique =
  `AlcoObjectHistory` (`AUDIT_TYPES` : `accounting.journalentry`, `accounting.journal`,
  `accounting.account`, `partners.partner`, `accounting.lettering`), compteur = son `total`.
  Visibilité d'une relation = `NavigationService.canOpenUrl('/app/comptabilite/<écran>')`
  (l'application ET l'écran : jamais `canOpenPath` seul, qui ignore la permission de
  l'application). Échéances (A5) et Lettrage (A4) : réels, avec le compteur du serveur. Emprunts et immobilisations d'un
  tiers : pas proposés (leurs écrans n'existent pas encore ; `loans?partner=`,
  `assets?partner=` existent dans l'API).
- **Grand livre (une seule expérience)** : `features/reporting/ledger/LedgerPage`, routes
  `analyse/grand-livre` (`data.ledger = 'account'`, `reporting.read`) et
  `analyse/grand-livre-auxiliaire` (`'partner'`, `reporting.read_auxiliary`) ; jamais
  `accounting/accounts/<id>/ledger/` (consultation du module comptable). Objet par son code
  (`accounts?code=`, `partners?code=` — `PartnersApi.byCode`, `partners.read`), exercice choisi
  (URL, sinon l'ouvert qui contient le jour, sinon le premier ouvert, sinon le plus récent),
  4 requêtes fixes. Export `reporting.ledger` (`account`, `fiscal_year`) sans sous-comptes.
- **Liens d'une écriture** : journal, comptes, tiers (`partners.read`) par leurs `public_id` ;
  opérations de trésorerie liées (`treasury/operations/?accounting_entry=`, `treasury.read`) ;
  source nommée (`source_type`), sans lien tant que l'écran du domaine n'existe pas.
- **Écritures (Module 5)** : `features/accounting/entries` sur `accounting/entries/`. Liste =
  filtres de l'API seulement (aucune recherche texte dans l'API → pas de barre de recherche ;
  compte et tiers filtrés par code dans l'URL, trouvés par le serveur), 25 par page, pas de
  regroupement. Workflow = commandes `submit`/`reject`/`validate`/`lock`/`reverse` (jamais
  `PATCH status`), actions selon l'état, les permissions et `accounting/settings/`
  (`submission_required`), confirmées ; `accounting_invalid_transition` recharge la fiche.
  Modification d'un brouillon manuel non contrepassé : champs changés, lignes complètes avec
  un changement de ligne, journal, date, devise ou arrondi ; lignes à répartition analytique
  non modifiables ici. Totaux et écart = aide d'affichage (`shared/utils/decimal`), montants
  à la précision de la devise (`decimal_places`, zéros finaux retirés, jamais d'arrondi).
  Pièces = Documents (`accounting.entry`), historique = Audit (`accounting.journalentry`).
- **Lettrage (V2.1 A4)** : `features/accounting/lettering` sur `accounting/letterable-lines/`
  et `accounting/letterings/` (ux-guidelines § 5 septies, technical-architecture § 7 quinquies).
  `/app/comptabilite/lettrage` : onglets Lignes à lettrer, Propositions, Lettrages (`?vue=`),
  compte et tiers par code (`?compte=`, `?tiers=`, trouvés par le serveur), dates, état,
  référence, page dans l'URL ; `/lettrage/:id` : fiche, Délettrer (`accounting.unletter`,
  motif, `POST …/unletter/`), historique Audit (`accounting.lettering`). Sélection
  (`accounting.letter`) gardée entre les pages de la même liste ; totaux débit / crédit /
  écart = aide de lecture (BigInt) ; aperçu `letterings/preview/` (panneau, rien n'est écrit)
  puis `POST letterings/` ; partiel seulement si demandé (`allow_partial`) ; `write_off` jamais
  envoyé ; une clé d'idempotence par aperçu ou par proposition, renvoyée en cas de nouvel
  essai ; après chaque commande ou refus « périmé » (`STALE_CODES`), données relues et
  sélection vidée, jamais d'état simulé. Propositions affichées telles que le serveur les
  donne, confirmées par `letterings/proposals/confirm/`. Téléphone : lignes en cartes, barre de
  sélection collée en bas. Smart buttons Lettrage : fiche Compte (compte `letterable`) et
  fiche Tiers, nombre = `count` de `letterable-lines/?status=open&page_size=1`. Compte :
  « Compte lettrable » dans son formulaire (`accounting.manage_accounts`). Ancienne URL
  `/app/comptabilite/tiers/lettrage` → `/app/comptabilite/lettrage`. Le contrat ne donne ni
  la référence du lettrage d'une ligne, ni un motif de proposition, ni d'avertissement
  d'aperçu : rien n'est inventé.
- **Échéances et balance âgée (V2.1 A5)** : `features/accounting/dues` (ux-guidelines
  § 5 octies, technical-architecture § 7 sexies) : `/echeances` (onglets Échéances et
  Échéances à générer, filtres de l'API, état dans l'URL), `/echeances/<id>` (règlements et
  lettrage source), `/echeances/echeanciers/<id>` (condition au calcul, Recalculer avec motif,
  historique). Génération (`POST due-schedules/`) et recalcul : commandes confirmées
  (`accounting.manage_due_dates`), résultat du serveur affiché, données relues.
  `features/reporting/aging` : `analyse/balance-clients` et `analyse/balance-fournisseurs`
  (`data.aging` = rôle ; date de référence choisie puis confirmée, `?au=`, aucune requête
  avant ; synthèse, tranches et montants de l'API ; drill-down tiers → documents → échéance →
  écriture ; une tranche (`?tranche=<code>`, A5.1) = paramètre `bucket` : la liste complète et
  paginée du serveur, jamais un filtre local),
  `configuration/balance-agee` (tranches, `reporting.manage_aging`, confirmées). Fiche Tiers :
  smart button Échéances (`count` de `due-items/?partner`). Ancienne URL
  `/app/comptabilite/tiers/echeances` → `/echeances`. Faux serveur `e2e/support/fake-dues.ts` :
  fixtures explicites, rien de calculé.
- **Rapprochement bancaire (V2.1 A6)** : `features/treasury/reconciliation` sur
  `treasury/` (ux-guidelines § 5 nonies, technical-architecture § 7 septies).
  `/app/comptabilite/tresorerie/rapprochements` (Comptabilité ▾ › Rapprochement, section
  Trésorerie › Rapprochements, `treasury.read`) : compte par code (`?compte=`, choisi d'office
  s'il est seul), relevé (`?releve=`), onglets À rapprocher / Propositions / Rapprochées /
  Exclues (`?vue=`, un `status` de l'API par onglet), page dans l'URL. Ligne ouverte (depuis la
  liste) : ses rapprochements par `reconciliations/?statement_line=` (lot backend A6.2), leurs
  opérations (`operations/{id}/`), le lettrage créé à la confirmation (lien vers Lettrage),
  historique Audit (`treasury.reconciliation`). Propositions telles que le serveur les donne
  (critères en mots, aucun score) ; sélection et « Régler aussi cette facture »
  (`accounting.letter`, jamais coché d'office) ; confirmation (boîte de dialogue, une commande,
  tout ou rien), résultat de l'API affiché, propositions relues ;
  `treasury_reconciliation_proposal_stale` relit et vide la sélection. Dé-rapprocher
  (`treasury.reconcile`, motif) : la boîte de dialogue et le message disent que seul le lien
  bancaire est annulé (A6.1) — opération, écriture, lettrage et échéances inchangés, délettrage
  dans Lettrage. Faux serveur `e2e/support/fake-treasury.ts` : fixtures explicites, aucune
  correspondance jouée.
- **Écran d'import générique** : l'utilisateur choisit seulement le fichier, CSV/TXT ou Excel
  `.xlsx` ; le serveur le lit (`parse` sans corps : encodage et séparateur d'un CSV, feuille
  d'un classeur ; plusieurs feuilles : étape « Choisir la feuille », `parse` avec `sheet`).
  Étape « Lecture » : « Fichier analysé » (format, feuille, colonnes, lignes, encodage et
  séparateur en secondaire pour un CSV) et aperçu des 5 premières lignes (`rows/`,
  `TransfersApi.firstRows`), puis « Continuer vers la correspondance des colonnes ». Indécis ou
  refusé : bloqué avec le motif. Forcer (CSV) : « Options avancées », fermées par défaut.
  `.xls`, `.xlsm` refusés. Captures : `docs/frontend/captures/97…102`.
- **Taxes, un seul écran simple** (`features/taxes/`, note backend 0031) :
  - liste : Nom, Taux, S'applique à, Compte des ventes, Compte des achats, Actif
    (interrupteur, commande) ; « Créer les taxes de Guinée » (`accounting/default-taxes/`) ;
  - une page par taxe, pour la créer ou la modifier : nom, taux, côtés (ventes, achats, les
    deux), le compte de chaque côté choisi dans une liste (les comptes de l'État, 44…, du
    plan), retenue à la source, actif ;
  - à la saisie d'une écriture, un journal de ventes ne propose que les taxes de ventes (et
    des deux côtés), un journal d'achats celles d'achats ;
  - faux serveur : `fake-accounting-entries.ts` ; e2e : `e2e/taxes.spec.ts` ;
    captures `107…109`.
- **Formulaire de compte** : Code, Nom du compte ; Type groupé comme Odoo (`TYPE_SECTIONS`,
  18 types) avec « Selon le code » à la création (le serveur donne le type SYSCOHADA du
  code), Taxes par défaut, Devise, Autoriser le lettrage (laissé au serveur s'il n'est pas
  touché : clients et fournisseurs lettrés), Obsolète (commandes), Groupe en lecture ;
  Journaux autorisés seulement sur un compte qui en a ; plus de Société. Liste : Code, Nom
  du compte, Type, Autoriser le lettrage (interrupteur), Devise ; plus de filtre
  « Imputable ».
- **Plan comptable comme Odoo** : panneau « Groupes de comptes » (préfixes du serveur,
  `?prefixe=`, un filtre jamais une hiérarchie), colonnes Type détaillé, Devise, Société ;
  formulaire avec type détaillé (de la nature) et devise. Faux serveur :
  `fake-accounting.ts` (`prefixes`, `code_prefix`).
- **Import du plan comptable** : Plan comptable › Actions ▾ › Importer des comptes
  (`ACCOUNT_TRANSFER`, type `accounting.accounts`, route `plan-comptable/import`), écran
  d'import générique ; plan à plat (aucun parent), type traduit par le serveur. Validation et
  import : délai `uploadTimeoutMs`. Faux serveur : `e2e/support/fake-account-import.ts`.
- **Trésorerie (Module 6)** : `features/treasury` (ux-guidelines § 5 decies,
  technical-architecture § 7 octies), routes `tresorerie/…` de `treasury.routes.ts` servies
  parmi celles de la section (`placeholder-routes.ts` : accueil et fil d'Ariane de la section).
  Comptes (filtres de l'API, fiche avec solde du serveur, relations par les filtres officiels,
  gestion `treasury.manage_accounts`), opérations (9 filtres de l'API dans l'URL, fiche, pièces
  `treasury.operation`, commandes selon l'état et les permissions, brouillon avec clé
  d'idempotence), virements (deux opérations ensemble), relevés (contrôle du serveur, étapes,
  lignes par état : rapprochée protégée, exclusion motivée, clôture refusée tant qu'un écart
  reste), import `treasury.statements` par l'écran d'import générique (format des dates et
  séparateur décimal — `options` —, lignes à vérifier listées, pour tous les domaines). Aucun
  solde, contrôle ni doublon calculé. Corps des commandes : OpenAPI depuis le lot backend M6.0.
  Non proposés (contrat) : `link-entry` (pas de filtre des écritures par numéro), création
  manuelle d'un relevé (l'import la couvre). Faux serveur : `e2e/support/fake-treasury*.ts`.
- **Modifications non enregistrées** : `UnsavedChangesService.track(() => form.dirty)` dans
  chaque formulaire, `unsavedChangesGuard` sur ses routes ; `switchTo` demande aussi ; une
  sauvegarde réussie appelle `markAsPristine()` avant de naviguer.
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
  clôture) ; « Paramètres comptables » (`accounting/settings/`, lu par les écritures).
- Écritures : noms des comptes et tiers dans les lignes de la fiche (l'API ne donne que le
  code) ; saisie de la répartition analytique (module Analytique) ; remplacement et
  suppression d'une pièce (`documents/{id}/replace|delete`) ; export des écritures (absent de
  l'API V1).
- Tiers : écran « Conditions de paiement » (API complète ; menu Comptabilité › Configuration ›
  Paiements) ; rapport d'import paginé au-delà de 50 lignes refusées ; export asynchrone pour
  les gros volumes.
- Analyse : construire les rapports sur `reporting/` (balance, grand livre par compte,
  balances clients et fournisseurs, états financiers, résultat, analytique) ; aujourd'hui des
  écrans prévus. Lettrage, échéances, balance âgée, journal centralisateur, chatter,
  notifications, favoris persistants : lots dédiés (backend d'abord).
- Emprunts et immobilisations d'un tiers quand leurs écrans existeront.
- Échéances : génération par écriture (`entry`, offert par l'API) depuis la fiche d'une écriture ; la
  balance auxiliaire classique (`reporting/partners/`) reste un écran à construire.
- Lettrage : passage d'un écart en perte ou profit quand le backend aura une règle (aujourd'hui
  refusé) ; référence du lettrage d'une ligne et motif d'une proposition si le contrat les
  expose ; recherche de compte et de tiers par autocomplétion dans les filtres.
- Domaines utilisés par société (`features`) : à exposer par le backend (puis écran
  Paramètres) avant de masquer quoi que ce soit pour cette raison.
- Actions GitHub `checkout`/`setup-node` v4 → v5 (Node 20 déprécié) ; `ubuntu-latest` passe
  à Ubuntu 26 le 19/10/2026.
- `AlcoDrawer` (non construit, pas d'usage) ; mode sombre (tokens prêts à être redéfinis).
- Regroupement côté serveur (le prototype regroupe la page courante) et sous-totaux fournis
  par l'API.
- Graphiques du tableau de bord (charger la compétence dataviz avant d'en dessiner).
- Imports/exports non proposés par l'API V1 : décision métier puis backend.
