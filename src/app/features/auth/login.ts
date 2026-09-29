import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { safeReturnUrl } from '../../core/auth/return-url';
import { LOGIN_REASON, LOGIN_RETURN, SessionService } from '../../core/auth/session.service';
import { serverFieldErrors } from '../../core/errors/field-errors';
import { UserError, toUserError } from '../../core/errors/user-error';
import { ApiError, toApiError } from '../../core/http/api-error';
import { AlcoLogo } from '../../core/layout/logo/logo';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoIcon } from '../../shared/ui/icon/icon';
import { LOGIN_ERRORS, LOGIN_FIELD_MESSAGES, waitMessage } from './login-errors';

/** Codes whose technical details are useless to the user (the message says it all). */
const SELF_EXPLANATORY = new Set(['invalid_credentials', 'throttled', 'validation_error']);

/**
 * `/login` — e-mail and password against the Django session (`POST auth/login/`, CSRF by the
 * interceptor). Then the company context and the page the user asked for (`?retour=`, only
 * inside `/app`). No « remember me » (the server decides the session length), no password
 * reset (no such endpoint yet). The password never leaves this form except in the request.
 */
@Component({
  selector: 'alco-login',
  imports: [
    ReactiveFormsModule,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoIcon,
    AlcoInput,
    AlcoLogo,
  ],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginPage {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly params = toSignal(inject(ActivatedRoute).queryParamMap, { requireSync: true });

  private readonly emailInput = viewChild.required<ElementRef<HTMLInputElement>>('emailInput');
  private readonly passwordInput =
    viewChild.required<ElementRef<HTMLInputElement>>('passwordInput');
  // A template reference on a component host gives the component: read the element.
  private readonly submitButton = viewChild.required('submitButton', {
    read: ElementRef<HTMLButtonElement>,
  });

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', { nonNullable: true, validators: Validators.required }),
  });

  protected readonly reason = computed(() => this.params().get(LOGIN_REASON));
  protected readonly showPassword = signal(false);
  protected readonly submitting = signal(false);
  protected readonly error = signal<UserError | null>(null);
  /** Seconds before a new attempt is allowed (429 `Retry-After`). */
  protected readonly waiting = signal(0);
  private countdown: ReturnType<typeof setInterval> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopCountdown());
    afterNextRender(() => this.emailInput().nativeElement.focus());
  }

  protected togglePassword(): void {
    this.showPassword.update((shown) => !shown);
  }

  protected async submit(): Promise<void> {
    if (this.submitting() || this.waiting() > 0) {
      return;
    }
    this.error.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.focus(this.form.controls.email.invalid ? this.emailInput() : this.passwordInput());
      return;
    }
    const { email, password } = this.form.getRawValue();
    this.submitting.set(true);
    try {
      await this.session.login(email.trim(), password);
    } catch (failure) {
      this.submitting.set(false);
      this.showFailure(toApiError(failure));
      return;
    }
    // The button stays busy until the requested page is shown.
    await this.router.navigateByUrl(safeReturnUrl(this.params().get(LOGIN_RETURN)));
  }

  /** « Réessayer » after an unreachable server at startup: back to the requested page. */
  protected retry(): void {
    void this.router.navigateByUrl(safeReturnUrl(this.params().get(LOGIN_RETURN)));
  }

  private showFailure(error: ApiError): void {
    if (error.code === 'validation_error') {
      const fields = serverFieldErrors(error, LOGIN_FIELD_MESSAGES);
      const names = Object.keys(fields).filter(
        (name): name is 'email' | 'password' => name === 'email' || name === 'password',
      );
      for (const name of names) {
        this.form.controls[name].setErrors({ server: fields[name] });
      }
      if (names.length > 0) {
        this.focus(names[0] === 'email' ? this.emailInput() : this.passwordInput());
        return;
      }
    }

    const text = toUserError(error, LOGIN_ERRORS);
    const technical = !error.code || !SELF_EXPLANATORY.has(error.code);
    this.error.set({
      ...text,
      message:
        error.kind === 'throttled' && error.retryAfter
          ? waitMessage(error.retryAfter)
          : text.message,
      code: technical ? text.code : '',
      correlationId: technical ? text.correlationId : undefined,
    });

    if (error.code === 'invalid_credentials') {
      this.form.controls.password.reset('');
      this.focus(this.passwordInput());
    } else {
      if (error.kind === 'throttled' && error.retryAfter) {
        this.startCountdown(error.retryAfter);
      }
      this.focus(this.submitButton());
    }
  }

  private startCountdown(seconds: number): void {
    this.stopCountdown();
    this.waiting.set(Math.ceil(seconds));
    this.countdown = setInterval(() => {
      this.waiting.update((left) => Math.max(0, left - 1));
      if (this.waiting() === 0) {
        this.stopCountdown();
      }
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdown !== null) {
      clearInterval(this.countdown);
      this.countdown = null;
    }
  }

  /** After the next render: a button just re-enabled can take the focus again. */
  private focus(element: ElementRef<HTMLElement>): void {
    afterNextRender(() => element.nativeElement.focus(), { injector: this.injector });
  }
}
