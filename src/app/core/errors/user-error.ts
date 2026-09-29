import {
  ApiError,
  ApiErrorEnvelope,
  ApiErrorKind,
  isApiErrorEnvelope,
  toApiError,
} from '../http/api-error';

/** Error envelope of the API (kept under this name for the feature catalogs). */
export type ApiErrorBody = ApiErrorEnvelope;

export interface ErrorText {
  /** What happened, in one sentence. */
  readonly title: string;
  /** What to do. */
  readonly message: string;
  /** Longer explanation behind « Comprendre l'erreur ». */
  readonly help?: string;
}

/** What the screen shows. `code` and `correlationId` only appear in « Détails techniques ». */
export interface UserError extends ErrorText {
  readonly code: string;
  readonly correlationId?: string;
}

/** Messages keyed by the API's stable `code` (never by its translated `message`). */
export type ErrorCatalog = Readonly<Record<string, ErrorText>>;

/**
 * Generic messages: backend codes shared by every endpoint, plus the transport failures
 * the front end detects itself (`network`, `timeout`, `unavailable` — not backend codes).
 */
export const GENERIC_ERRORS: ErrorCatalog = {
  network: {
    title: 'Le serveur ne répond pas.',
    message: 'Vérifiez votre connexion internet puis réessayez.',
  },
  timeout: {
    title: 'Le serveur met trop de temps à répondre.',
    message: 'Réessayez dans un instant. Rien n’a été enregistré si l’action n’a pas abouti.',
  },
  unavailable: {
    title: 'Le service est momentanément indisponible.',
    message: 'Réessayez dans quelques minutes.',
  },
  not_authenticated: {
    title: 'Votre session a expiré.',
    message: 'Reconnectez-vous pour continuer.',
  },
  csrf_failed: {
    title: 'La page n’est plus à jour.',
    message: 'Rechargez la page puis recommencez.',
  },
  permission_denied: {
    title: 'Vous n’avez pas le droit d’effectuer cette action.',
    message: 'Demandez l’accès à un administrateur de la société si vous en avez besoin.',
  },
  company_permission_denied: {
    title: 'Vous n’avez pas le droit d’effectuer cette action dans cette société.',
    message: 'Demandez l’accès à un administrateur de la société si vous en avez besoin.',
  },
  company_access_denied: {
    title: 'Vous n’avez pas accès à cette société.',
    message: 'Choisissez une autre société dans la barre du haut.',
  },
  company_required: {
    title: 'Aucune société n’est sélectionnée.',
    message: 'Choisissez une société dans la barre du haut.',
  },
  not_found: {
    title: 'Cet élément n’existe pas ou plus.',
    message: 'Il a peut-être été supprimé. Revenez à la liste.',
  },
  validation_error: {
    title: 'Certaines informations sont incorrectes.',
    message: 'Corrigez les champs signalés puis réessayez.',
  },
  bad_request: {
    title: 'La demande n’a pas pu être traitée.',
    message: 'Vérifiez les informations saisies puis réessayez.',
  },
  throttled: {
    title: 'Trop de tentatives.',
    message: 'Patientez quelques instants avant de réessayer.',
  },
  server_error: {
    title: 'Une erreur inattendue s’est produite.',
    message: 'Réessayez. Si le problème continue, contactez le support avec la référence.',
  },
};

/** Message used when the server gave no code, by kind of failure. */
const KIND_MESSAGES: Readonly<Record<ApiErrorKind, string>> = {
  network: 'network',
  timeout: 'timeout',
  unavailable: 'unavailable',
  'bad-request': 'bad_request',
  unauthenticated: 'not_authenticated',
  forbidden: 'permission_denied',
  'not-found': 'not_found',
  throttled: 'throttled',
  server: 'server_error',
};

/**
 * Turns whatever failed (`ApiError`, API envelope, network error) into a human message.
 * Feature catalogs come first, then the generic one; an unknown code falls back to
 * `server_error` and keeps the code in the technical details.
 */
export function toUserError(failure: unknown, catalog: ErrorCatalog = {}): UserError {
  if (isApiErrorEnvelope(failure)) {
    const code = failure.error.code;
    const text = catalog[code] ?? GENERIC_ERRORS[code] ?? GENERIC_ERRORS['server_error'];
    return { ...text, code, correlationId: failure.error.correlation_id ?? undefined };
  }
  const error: ApiError = toApiError(failure);
  const fallback = KIND_MESSAGES[error.kind];
  const text =
    (error.code ? (catalog[error.code] ?? GENERIC_ERRORS[error.code]) : undefined) ??
    GENERIC_ERRORS[fallback];
  return {
    ...(text ?? GENERIC_ERRORS['server_error']),
    code: error.code ?? fallback,
    correlationId: error.correlationId ?? undefined,
  };
}
