import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { serverFieldErrors } from '../../../core/errors/field-errors';
import { UserError, toUserError } from '../../../core/errors/user-error';
import { toApiError } from '../../../core/http/api-error';
import { BreadcrumbService } from '../../../core/navigation/route-trail';
import { UnsavedChangesService } from '../../../core/navigation/unsaved-changes';
import { SessionStore } from '../../../core/session/session.store';
import { AlcoFormField } from '../../../shared/forms/form-field';
import { AlcoInput } from '../../../shared/forms/input';
import { AlcoBadge } from '../../../shared/ui/badge/badge';
import { AlcoButton } from '../../../shared/ui/button/button';
import { AlcoErrorState } from '../../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { Membership, SettingsApi } from '../data-access/settings-api';
import {
  PERMISSION_GROUPS,
  PermissionGroup,
  SETTINGS_ERRORS,
  initials,
  personName,
} from '../settings-presentation';

const LIST = '/app/parametres/roles';

/**
 * A member of the company and their rights (`memberships/{id}/`), or a new member
 * (`POST memberships/`, an existing account's e-mail): the rights checked by application,
 * an application at once by its own box. Only rights the user holds can be granted; their
 * own membership, or a member holding more than them, stays read only (backend rules).
 */
@Component({
  selector: 'alco-member-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoBadge,
    AlcoButton,
    AlcoErrorState,
    AlcoFormField,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './member-page.html',
  styleUrls: [
    '../../accounting/accounting-sheet.scss',
    '../settings-people.scss',
    './member-page.scss',
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MemberPage {
  private readonly api = inject(SettingsApi);
  private readonly router = inject(Router);
  private readonly session = inject(SessionStore);
  private readonly toast = inject(AlcoToastService);
  private readonly breadcrumb = inject(BreadcrumbService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');
  protected readonly isNew = !this.id;
  protected readonly list = LIST;
  protected readonly groups = PERMISSION_GROUPS;
  protected readonly name = personName;
  protected readonly initials = initials;

  protected readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });
  protected readonly member = signal<Membership | null>(null);
  protected readonly granted = signal<ReadonlySet<string>>(new Set());
  protected readonly active = signal(true);
  protected readonly dirty = signal(false);
  protected readonly loadError = signal<UserError | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);

  protected readonly ready = computed(() => this.isNew || this.member() !== null);
  protected readonly isSelf = computed(
    () => this.member()?.user.email === this.session.user()?.email,
  );
  /** The member holds a right the user lacks: the server refuses any change. */
  protected readonly outOfReach = computed(
    () => this.member()?.permissions.some((code) => !this.session.can(code)) ?? false,
  );
  protected readonly readOnly = computed(() => this.isSelf() || this.outOfReach());
  protected readonly title = computed(() => {
    const member = this.member();
    return member ? personName(member.user) : 'Nouveau membre';
  });
  protected readonly count = computed(() => this.granted().size);

  constructor() {
    inject(UnsavedChangesService).track(() => this.dirty() || this.email.dirty);
    if (this.id) {
      this.api.membership(this.id).subscribe({
        next: (member) => this.fill(member),
        error: (failure: unknown) => this.loadError.set(toUserError(failure, SETTINGS_ERRORS)),
      });
    }
  }

  /** The user may grant it: they hold it in this company. */
  protected grantable(code: string): boolean {
    return !this.readOnly() && this.session.can(code);
  }

  protected has(code: string): boolean {
    return this.granted().has(code);
  }

  protected countIn(group: PermissionGroup): number {
    const granted = this.granted();
    return group.items.filter((item) => granted.has(item.code)).length;
  }

  protected toggle(code: string, checked: boolean): void {
    const next = new Set(this.granted());
    if (checked) {
      next.add(code);
    } else {
      next.delete(code);
    }
    this.granted.set(next);
    this.dirty.set(true);
  }

  /** The application's box: every right the user may grant in it, or none. */
  protected toggleGroup(group: PermissionGroup, checked: boolean): void {
    const next = new Set(this.granted());
    for (const item of group.items) {
      if (this.grantable(item.code)) {
        if (checked) {
          next.add(item.code);
        } else {
          next.delete(item.code);
        }
      }
    }
    this.granted.set(next);
    this.dirty.set(true);
  }

  protected setActive(checked: boolean): void {
    this.active.set(checked);
    this.dirty.set(true);
  }

  /** A form of checkboxes, without a form group: its submission is handled here. */
  protected submit(event: Event): void {
    event.preventDefault();
    void this.save();
  }

  protected async save(): Promise<void> {
    if (this.saving() || this.readOnly()) {
      return;
    }
    this.error.set(null);
    if (this.isNew) {
      this.email.markAsTouched();
      if (this.email.invalid) {
        this.focusEmail();
        return;
      }
    }
    this.saving.set(true);
    const permissions = [...this.granted()].sort();
    try {
      const member = this.member();
      if (member) {
        const saved = await firstValueFrom(
          this.api.updateMembership(member.public_id, {
            permissions,
            ...(this.active() !== (member.status === 'active')
              ? { status: this.active() ? 'active' : 'inactive' }
              : {}),
          }),
        );
        this.fill(saved);
        this.toast.success(`Droits de ${personName(saved.user)} enregistrés.`);
        return;
      }
      const saved = await firstValueFrom(this.api.addMember(this.email.value.trim(), permissions));
      this.dirty.set(false);
      this.email.markAsPristine();
      this.toast.success(`${personName(saved.user)} est maintenant membre de la société.`);
      await this.router.navigate([LIST, saved.public_id], { replaceUrl: true });
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind === 'unauthenticated') {
        return;
      }
      const email = serverFieldErrors(error, {
        email: { unknown: 'Aucun compte actif avec cette adresse.' },
      })['email'];
      if (this.isNew && email) {
        this.email.setErrors({ server: email });
        this.focusEmail();
        return;
      }
      this.error.set(toUserError(error, SETTINGS_ERRORS));
    } finally {
      this.saving.set(false);
    }
  }

  protected discard(): void {
    const member = this.member();
    if (member) {
      this.fill(member);
    } else {
      void this.router.navigateByUrl(LIST);
    }
  }

  private fill(member: Membership): void {
    this.member.set(member);
    this.granted.set(new Set(member.permissions));
    this.active.set(member.status === 'active');
    this.dirty.set(false);
    this.breadcrumb.nameCurrent(personName(member.user));
  }

  private focusEmail(): void {
    this.host.nativeElement
      .querySelector<HTMLElement>('[formControlName="email"], #email')
      ?.focus();
  }
}
