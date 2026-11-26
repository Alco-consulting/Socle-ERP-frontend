import { DIALOG_DATA, Dialog, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { catchError, firstValueFrom, of } from 'rxjs';

import { AlcoFormField } from '../../shared/forms/form-field';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoModal } from '../../shared/ui/modal/modal';
import { normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { planTotals } from './analytics-presentation';
import { AnalyticsApi } from './data-access/analytics-api';
import { AnalyticValue, DistributionShare } from './data-access/analytics-models';

const TITLE_ID = 'alco-distribution-title';
const FULL = 1_000_000; // 100 % in hundredths of a hundredth.

interface ShareForm {
  value: FormControl<string>;
  percentage: FormControl<string>;
}

/** The analytic distribution of a line, as Odoo's: accounts of one or more plans, 100 % each. */
@Component({
  selector: 'alco-distribution-dialog',
  imports: [ReactiveFormsModule, AlcoButton, AlcoFormField, AlcoInput, AlcoModal],
  template: `
    <alco-modal title="Répartition analytique" [titleId]="titleId" (closed)="ref.close(null)">
      <p>
        Chaque plan fait 100 %. Vide : les modèles de répartition du compte s’appliquent à la
        validation.
      </p>
      <form id="distribution-form" class="shares" [formGroup]="form" (ngSubmit)="submit()">
        <div formArrayName="shares" class="shares">
          @for (share of shares.controls; track share; let i = $index) {
            <div class="share" [formGroupName]="i">
              <alco-form-field [label]="'Compte analytique ' + (i + 1)">
                <select alcoSelect formControlName="value" [attr.data-autofocus]="i === 0 || null">
                  <option value="" disabled>Choisir…</option>
                  @for (plan of plans(); track plan.code) {
                    <optgroup [label]="plan.name">
                      @for (account of plan.accounts; track account.public_id) {
                        <option [value]="account.public_id">
                          {{ account.code }} — {{ account.label }}
                        </option>
                      }
                    </optgroup>
                  }
                </select>
              </alco-form-field>
              <alco-form-field label="%">
                <input
                  alcoInput
                  [numeric]="true"
                  inputmode="decimal"
                  formControlName="percentage"
                  autocomplete="off"
                />
              </alco-form-field>
              <button
                alcoButton
                type="button"
                variant="ghost"
                icon="trash"
                [iconOnly]="true"
                (click)="remove(i)"
              >
                Retirer la part {{ i + 1 }}
              </button>
            </div>
          }
        </div>
        <div>
          <button alcoButton type="button" variant="ghost" icon="plus" (click)="add()">
            Ajouter un compte
          </button>
        </div>
      </form>
      @if (invalid()) {
        <p class="error" role="alert">{{ invalid() }}</p>
      }
      <ng-container alcoModalFooter>
        <button alcoButton type="button" (click)="ref.close(null)">Annuler</button>
        <button alcoButton type="submit" form="distribution-form" variant="primary">
          Appliquer
        </button>
      </ng-container>
    </alco-modal>
  `,
  styles: `
    .shares {
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
      margin-top: var(--space-3);
    }
    .share {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 6rem auto;
      gap: var(--space-2);
      align-items: end;
    }
    .error {
      margin: var(--space-3) 0 0;
      color: var(--color-danger-text);
      font-weight: var(--font-weight-medium);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlcoDistributionDialog {
  private readonly given = inject<readonly DistributionShare[]>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<readonly DistributionShare[] | null>>(DialogRef);
  protected readonly titleId = TITLE_ID;
  protected readonly invalid = signal<string | null>(null);
  private readonly accounts = toSignal(
    inject(AnalyticsApi)
      .values(null, 'active')
      .pipe(catchError(() => of([] as readonly AnalyticValue[]))),
    { initialValue: [] as readonly AnalyticValue[] },
  );
  /** The active accounts, plan by plan. */
  protected readonly plans = computed(() => {
    const byPlan = new Map<string, { code: string; name: string; accounts: AnalyticValue[] }>();
    for (const account of this.accounts()) {
      const plan = byPlan.get(account.axis.code) ?? {
        code: account.axis.code,
        name: account.axis.name,
        accounts: [],
      };
      plan.accounts.push(account);
      byPlan.set(account.axis.code, plan);
    }
    return [...byPlan.values()];
  });
  protected readonly form = new FormGroup({
    shares: new FormArray<FormGroup<ShareForm>>(
      this.given.map((share) => this.row(share.value, trimDecimalZeros(share.percentage, 0))),
    ),
  });

  constructor() {
    if (this.shares.length === 0) {
      this.add();
    }
  }

  protected get shares(): FormArray<FormGroup<ShareForm>> {
    return this.form.controls.shares;
  }

  protected add(): void {
    this.shares.push(this.row('', this.shares.length === 0 ? '100' : ''));
  }

  protected remove(index: number): void {
    this.shares.removeAt(index);
  }

  protected submit(): void {
    const chosen: DistributionShare[] = [];
    for (const share of this.shares.getRawValue()) {
      const account = this.accounts().find((item) => item.public_id === share.value);
      const percentage = normalizeDecimalInput(share.percentage);
      if (!account || percentage === null) {
        this.invalid.set('Choisissez chaque compte et son pourcentage (ex. 60).');
        return;
      }
      chosen.push({
        value: account.public_id,
        percentage,
        code: account.code,
        axis: account.axis.code,
      });
    }
    const wrong = [...planTotals(chosen)].find(([, total]) => total !== FULL);
    if (wrong) {
      this.invalid.set(`Le plan ${wrong[0]} ne fait pas 100 %.`);
      return;
    }
    this.ref.close(chosen);
  }

  private row(value: string, percentage: string): FormGroup<ShareForm> {
    return new FormGroup<ShareForm>({
      value: new FormControl(value, { nonNullable: true }),
      percentage: new FormControl(percentage, { nonNullable: true }),
    });
  }
}

/** Asks for a line's distribution; `null` when cancelled, `[]` to clear it. */
@Injectable({ providedIn: 'root' })
export class DistributionDialogService {
  private readonly dialog = inject(Dialog);

  ask(shares: readonly DistributionShare[]): Promise<readonly DistributionShare[] | null> {
    const ref = this.dialog.open<readonly DistributionShare[] | null, readonly DistributionShare[]>(
      AlcoDistributionDialog,
      {
        data: shares,
        ariaLabelledBy: TITLE_ID,
        backdropClass: 'alco-dialog-backdrop',
        panelClass: 'alco-dialog-panel',
        autoFocus: '[data-autofocus]',
        restoreFocus: true,
      },
    );
    return firstValueFrom(ref.closed).then((result) => result ?? null);
  }
}
