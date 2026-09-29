import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { ApiClient } from '../http/api-client';

/** `CurrentUserSerializer` of the backend (`auth/me/`, `auth/login/`). */
export interface CurrentUserDto {
  readonly public_id: string;
  readonly email: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly is_active: boolean;
  /** Global permissions (outside any company), e.g. `users.read`. */
  readonly permissions: readonly string[];
}

/**
 * Django session endpoints (`/api/v1/auth/`). No JWT, no token stored by the front end: the
 * session is an HttpOnly cookie handled by the browser; unsafe calls carry the CSRF header
 * (interceptor). The login screen comes with the Authentication module.
 */
@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly api = inject(ApiClient);

  /** The connected user; 403 `not_authenticated` without a valid session (not an expiry). */
  me(): Observable<CurrentUserDto> {
    return this.api.get<CurrentUserDto>('auth/me/', {
      skipCompany: true,
      skipSessionExpiry: true,
    });
  }

  /** Opens a new session (new key, new CSRF token). 400 `invalid_credentials` on failure. */
  login(email: string, password: string): Observable<CurrentUserDto> {
    return this.api.post<CurrentUserDto>(
      'auth/login/',
      { email, password },
      { skipCompany: true, skipSessionExpiry: true },
    );
  }

  /** Ends the session (204). */
  logout(): Observable<void> {
    return this.api.post<void>('auth/logout/', null, {
      skipCompany: true,
      skipSessionExpiry: true,
    });
  }
}
