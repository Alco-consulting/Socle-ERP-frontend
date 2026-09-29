import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * The HTTP layer reports here what ends the current context; the session and company
 * services decide what to do (once). Keeps `core/http` free of any session logic.
 * - « the server no longer recognises this session » (403 `not_authenticated`);
 * - « the server refuses the company sent in `X-Company-ID` » (403 `company_access_denied`:
 *   membership ended, company deactivated…), with that company's identifier.
 */
@Injectable({ providedIn: 'root' })
export class AuthFailures {
  private readonly failures = new Subject<void>();
  private readonly companyRefusals = new Subject<string>();

  readonly unauthenticated$: Observable<void> = this.failures.asObservable();
  readonly companyRefused$: Observable<string> = this.companyRefusals.asObservable();

  report(): void {
    this.failures.next();
  }

  reportCompanyRefused(companyId: string): void {
    this.companyRefusals.next(companyId);
  }
}
