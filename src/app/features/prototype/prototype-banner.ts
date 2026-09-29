import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AlcoIcon } from '../../shared/ui/icon/icon';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { PROTOTYPE_PROFILES, PrototypeProfile, PrototypeSession } from './prototype-session';

/**
 * PROTOTYPE — permanent strip stating that everything is fictitious, with the simulated
 * profile switch used to review permission-based screens. Removed with the prototype.
 */
@Component({
  selector: 'alco-prototype-banner',
  imports: [AlcoIcon],
  template: `
    <div class="banner" role="note" aria-label="Prototype">
      <alco-icon name="info" [size]="16" />
      <p>
        <strong>Prototype UX</strong>
        <span class="detail"
          >&nbsp;— données fictives, aucune donnée comptable réelle, aucun appel à l’API.</span
        >
      </p>
      <label class="profile">
        <span>Profil simulé</span>
        <select (change)="onProfileChange($event)">
          @for (option of profiles; track option.id) {
            <option [value]="option.id" [selected]="option.id === prototype.profile()">
              {{ option.label }}
            </option>
          }
        </select>
      </label>
    </div>
  `,
  styles: `
    .banner {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--prototype-banner-height);
      padding: var(--space-1) var(--page-gutter);
      background: var(--color-warning-soft);
      color: var(--color-warning-text);
      font-size: var(--font-size-caption);
    }
    p {
      flex: 1;
      min-width: 0;
    }
    .profile {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      white-space: nowrap;
    }
    select {
      height: 24px;
      padding: 0 var(--space-2);
      border: var(--border-width) solid var(--color-warning);
      border-radius: var(--radius-sm);
      background: var(--color-surface);
      color: var(--color-text);
      font-size: var(--font-size-caption);
    }
    @media (max-width: 767.98px) {
      .detail {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoPrototypeBanner {
  protected readonly prototype = inject(PrototypeSession);
  private readonly router = inject(Router);
  private readonly toast = inject(AlcoToastService);

  protected readonly profiles = (Object.keys(PROTOTYPE_PROFILES) as PrototypeProfile[]).map(
    (id) => ({ id, label: PROTOTYPE_PROFILES[id].label }),
  );

  protected onProfileChange(event: Event): void {
    const profile = (event.target as HTMLSelectElement).value as PrototypeProfile;
    this.prototype.applyProfile(profile);
    this.toast.info(`Profil simulé : ${PROTOTYPE_PROFILES[profile].label}.`);
    // Back to the launcher: the visible applications depend on the profile.
    void this.router.navigateByUrl('/app');
  }
}
