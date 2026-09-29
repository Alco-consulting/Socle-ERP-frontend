import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { AlcoApplication } from '../../navigation/applications';
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

  /** Current application; absent on the launcher. */
  readonly app = input<AlcoApplication | null>(null);

  protected readonly unread = this.notificationCenter.unreadCount;

  protected readonly companyItems = computed<readonly DropdownItem[]>(() =>
    this.session.companies().map((company) => ({
      id: company.id,
      label: company.name,
      description: `${company.fiscalYearLabel} · ${company.currency}`,
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
      description: 'Inactif dans le prototype',
      disabled: true,
      dividerBefore: true,
    },
  ];

  protected onCompanySelected(item: DropdownItem): void {
    if (item.id !== this.session.activeCompany()?.id) {
      this.session.switchCompany(item.id);
      this.toast.info(`Société active : ${item.label}.`);
      // Menus depend on the company (permissions, domains it uses): restart from the home
      // of the current application when it is still available, from the launcher otherwise.
      const app = this.app();
      void this.router.navigateByUrl(
        app && this.navigation.canOpen(app) ? this.navigation.homeUrl(app) : '/',
      );
    }
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
