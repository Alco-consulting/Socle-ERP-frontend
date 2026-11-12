import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AlcoDropdown, DropdownItem } from '../../../shared/ui/dropdown/dropdown';
import { AlcoIcon } from '../../../shared/ui/icon/icon';
import { AlcoToastService } from '../../../shared/ui/toast/toast.service';
import { SessionService } from '../../auth/session.service';
import { CompanyContextService } from '../../company/company-context.service';
import { toUserError } from '../../errors/user-error';
import { ApiError } from '../../http/api-error';
import { APP_ROOT, AlcoApplication } from '../../navigation/applications';
import { NotificationCenter } from '../../notifications/notification-center';
import { SessionStore } from '../../session/session.store';
import { ThemeService } from '../../theme/theme.service';
import { CommandPaletteService } from '../command-palette/command-palette.service';
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
  host: { '(document:keydown)': 'palette.onKeydown($event)' },
})
export class AlcoTopbar {
  protected readonly session = inject(SessionStore);
  private readonly notificationCenter = inject(NotificationCenter);
  private readonly toast = inject(AlcoToastService);
  private readonly companyContext = inject(CompanyContextService);
  private readonly sessionService = inject(SessionService);
  protected readonly theme = inject(ThemeService);
  protected readonly palette = inject(CommandPaletteService);

  /** Current application; absent on the launcher. */
  readonly app = input<AlcoApplication | null>(null);

  protected readonly unread = this.notificationCenter.unreadCount;
  protected readonly home = APP_ROOT;

  /** The companies the server lists; an inactive one (platform administrator) says so. */
  protected readonly companyItems = computed<readonly DropdownItem[]>(() =>
    this.session.companies().map((company) => ({
      id: company.id,
      label: company.name,
      description: [
        company.legalName !== company.name ? company.legalName : '',
        company.currency,
        company.active ? '' : 'Inactive',
      ]
        .filter(Boolean)
        .join(' · '),
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

  /** The account, then the logout (the theme has its own switch in the bar). */
  protected readonly userItems: readonly DropdownItem[] = [
    { id: 'profile', label: 'Mon profil', icon: 'user', disabled: true },
    { id: 'logout', label: 'Se déconnecter', icon: 'logout', dividerBefore: true },
  ];

  /**
   * The new theme is revealed from the pointer; from the keyboard (`detail` 0: no pointer),
   * from the button's centre.
   */
  protected toggleTheme(event: MouseEvent): void {
    if (event.detail === 0) {
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      this.theme.toggle({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
    } else {
      this.theme.toggle({ x: event.clientX, y: event.clientY });
    }
  }

  /**
   * The server gives the chosen company's permissions; the screens of the previous company
   * are rebuilt for the new one (`CompanyContextService.switchTo`, which says any failure).
   */
  protected onCompanySelected(item: DropdownItem): void {
    void this.companyContext.switchTo(item.id);
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
        'Ctrl+K : rechercher · Tab / Maj+Tab : se déplacer · Entrée : ouvrir · Échap : fermer un menu · Flèches : naviguer dans un menu ou des onglets.',
      );
    }
  }
}
