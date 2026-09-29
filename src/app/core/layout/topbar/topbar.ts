import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { SessionService } from '../../auth/session.service';
import { CompanyContextService } from '../../company/company-context.service';
import { APP_CONFIG } from '../../config/app-config';
import { toUserError } from '../../errors/user-error';
import { ApiError } from '../../http/api-error';
import { APP_ROOT, AlcoApplication } from '../../navigation/applications';
import { NavigationService } from '../../navigation/navigation.service';
import { NotificationCenter } from '../../notifications/notification-center';
import { SessionStore } from '../../session/session.store';
import { AlcoLogo } from '../logo/logo';

/**
 * Top bar, identical everywhere: [apps] logo | application — société, aide, notifications,
 * utilisateur. The active company is always visible and switchable here.
 */
@Component({
  selector: 'alco-topbar',
  imports: [RouterLink, AlcoDropdown, AlcoIcon, AlcoLogo],
  templateUrl: './topbar.html',
  styleUrl: './topbar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoTopbar {
  protected readonly session = inject(SessionStore);
  private readonly notificationCenter = inject(NotificationCenter);
  private readonly toast = inject(AlcoToastService);
  private readonly navigation = inject(NavigationService);
  private readonly router = inject(Router);
  private readonly companyContext = inject(CompanyContextService);
  private readonly sessionService = inject(SessionService);
  private readonly prototype = inject(APP_CONFIG).sessionSource === 'prototype';

  /** Current application; absent on the launcher. */
  readonly app = input<AlcoApplication | null>(null);

  protected readonly unread = this.notificationCenter.unreadCount;
  protected readonly home = APP_ROOT;

  protected readonly companyItems = computed<readonly DropdownItem[]>(() =>
    this.session.companies().map((company) => ({
      id: company.id,
      label: company.name,
      description: [company.fiscalYearLabel, company.currency].filter(Boolean).join(' · '),
      checked: company.id === this.session.activeCompany()?.id,
    })),
  );

  protected readonly notificationItems = computed<readonly DropdownItem[]>(() => {
    const list = this.notificationCenter.notifications();
    if (list.length === 0) {
      return [{ id: 'none', label: 'Aucune notification', disabled: true }];
    }
    return list.map((item) => ({
      id: item.id,
      label: item.title,
      description: item.read ? item.detail : `Non lue · ${item.detail}`,
      route: item.url,
    }));
  });

  protected readonly helpItems: readonly DropdownItem[] = [
    {
      id: 'guide',
      label: 'Guide d’utilisation',
      icon: 'book',
      description: 'Disponible avec les modules métier',
      disabled: true,
    },
    { id: 'keyboard', label: 'Raccourcis clavier', icon: 'keyboard' },
    {
      id: 'catalog',
      label: 'Catalogue du design system',
      icon: 'palette',
      route: '/design-system',
    },
  ];

  protected readonly userItems: readonly DropdownItem[] = [
    { id: 'profile', label: 'Mon profil', icon: 'user', disabled: true },
    {
      id: 'logout',
      label: 'Se déconnecter',
      icon: 'logout',
      description: this.prototype ? 'Inactif dans le prototype' : undefined,
      disabled: this.prototype,
      dividerBefore: true,
    },
  ];

  protected async onCompanySelected(item: DropdownItem): Promise<void> {
    if (item.id === this.session.activeCompany()?.id) {
      return;
    }
    try {
      // The server returns the permissions of the chosen company with it.
      await this.companyContext.select(item.id);
    } catch (failure) {
      this.report(failure);
      return;
    }
    this.toast.info(`Société active : ${item.label}.`);
    // Menus depend on the company (permissions, domains it uses): restart from the home
    // of the current application when it is still available, from the launcher otherwise.
    const app = this.app();
    void this.router.navigateByUrl(
      app && this.navigation.canOpen(app) ? this.navigation.homeUrl(app) : APP_ROOT,
    );
  }

  protected async onUserSelected(item: DropdownItem): Promise<void> {
    if (item.id !== 'logout') {
      return;
    }
    try {
      await this.sessionService.logout();
    } catch (failure) {
      this.report(failure);
    }
  }

  /** An ended session is explained by the login screen: no second message here. */
  private report(failure: unknown): void {
    if (failure instanceof ApiError && failure.kind === 'unauthenticated') {
      return;
    }
    const error = toUserError(failure);
    this.toast.error(`${error.title} ${error.message}`);
  }

  protected onNotificationSelected(item: DropdownItem): void {
    this.notificationCenter.markRead(item.id);
  }

  protected onHelpSelected(item: DropdownItem): void {
    if (item.id === 'keyboard') {
      this.toast.info(
        'Tab / Maj+Tab : se déplacer · Entrée : ouvrir · Échap : fermer un menu · Flèches : naviguer dans un menu ou des onglets.',
      );
    }
  }
}
