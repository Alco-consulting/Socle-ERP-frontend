/** Error envelope of the API: `{"error": {"code", "message", "details", "correlation_id"}}`. */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
    readonly correlation_id?: string;
  };
}

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

export const GENERIC_ERRORS: ErrorCatalog = {
  network: {
    title: 'Le serveur ne répond pas.',
    message: 'Vérifiez votre connexion internet puis réessayez.',
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
  company_access_denied: {
    title: 'Vous n’avez pas accès à cette société.',
    message: 'Choisissez une autre société dans la barre du haut.',
  },
  not_found: {
    title: 'Cet élément n’existe pas ou plus.',
    message: 'Il a peut-être été supprimé. Revenez à la liste.',
  },
  validation_error: {
    title: 'Certaines informations sont incorrectes.',
    message: 'Corrigez les champs signalés puis réessayez.',
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

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  const error = (value as { error?: { code?: unknown } } | null)?.error;
  return typeof error?.code === 'string';
}

/**
 * Turns whatever failed (API envelope, network error) into a human message.
 * Feature catalogs come first, then the generic one; an unknown code falls back to
 * `server_error` and keeps the code in the technical details.
 */
export function toUserError(failure: unknown, catalog: ErrorCatalog = {}): UserError {
  const body = isApiErrorBody(failure) ? failure : null;
  const code = body?.error.code ?? 'network';
  const text = catalog[code] ?? GENERIC_ERRORS[code] ?? GENERIC_ERRORS['server_error'];
  return { ...text, code, correlationId: body?.error.correlation_id };
}
