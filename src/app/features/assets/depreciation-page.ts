import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom, map } from 'rxjs';

import { toUserError } from '../../core/errors/user-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoCard } from '../../shared/ui/card/card';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { localToday } from '../../shared/utils/dates';
import { ASSET_ERRORS, lastMonthEnd, monthEnd, refusalText } from './assets-presentation';
import { AssetsApi } from './data-access/assets-api';
import { PostedDepreciation } from './data-access/assets-models';

/** « Comptabiliser les dotations jusqu'au… »: every asset at once, each month or before closing. */
@Component({
  selector: 'alco-depreciation-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AlcoButton,
    AlcoCard,
    AlcoFormField,
    AlcoInput,
    AlcoPageHeader,
  ],
  templateUrl: './depreciation-page.html',
  styleUrl: './depreciation-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DepreciationPage {
  private readonly api = inject(AssetsApi);
  private readonly toast = inject(AlcoToastService);
  private readonly session = inject(SessionStore);

  protected readonly canPost = computed(
    () => this.session.can('assets.depreciate') && this.session.can('assets.account'),
  );
  protected readonly month = new FormControl(lastMonthEnd(localToday()).slice(0, 7), {
    nonNullable: true,
    validators: [Validators.required, Validators.pattern(/^\d{4}-\d{2}$/)],
  });
  protected readonly posting = signal(false);
  protected readonly result = signal<PostedDepreciation | null>(null);
  /** How many depreciation lines remain to post by the end of the month chosen. */
  protected readonly due = requestState(() =>
    this.api.dueCount(monthEnd(this.month.value)).pipe(map((page) => page.count)),
  );

  constructor() {
    this.month.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.result.set(null);
      if (this.month.valid) {
        this.due.reload();
      }
    });
  }

  protected refusal(code: string): string {
    return refusalText(code);
  }

  protected async post(): Promise<void> {
    if (this.posting() || this.month.invalid) {
      return;
    }
    this.posting.set(true);
    try {
      const result = await firstValueFrom(this.api.postDue(monthEnd(this.month.value)));
      this.result.set(result);
      if (result.failures.length === 0) {
        this.toast.success(
          result.posted === 0
            ? 'Aucune dotation à comptabiliser.'
            : `${result.posted} dotation${result.posted > 1 ? 's' : ''} comptabilisée${result.posted > 1 ? 's' : ''}.`,
        );
      }
    } catch (failure) {
      const error = toUserError(failure, ASSET_ERRORS);
      this.toast.error(`${error.title} ${error.message}`);
    } finally {
      this.posting.set(false);
      this.due.reload();
    }
  }
}
