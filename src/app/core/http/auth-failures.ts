import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * The HTTP layer reports « the server no longer recognises this session » here; the session
 * service decides what to do (once). Keeps `core/http` free of any authentication logic.
 */
@Injectable({ providedIn: 'root' })
export class AuthFailures {
  private readonly failures = new Subject<void>();

  readonly unauthenticated$: Observable<void> = this.failures.asObservable();

  report(): void {
    this.failures.next();
  }
}
