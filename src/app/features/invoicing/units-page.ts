import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Observable, firstValueFrom, map } from 'rxjs';

import { ErrorCatalog, UserError, toUserError } from '../../core/errors/user-error';
import { toApiError } from '../../core/http/api-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { formatDecimal, normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { InvoicingApi } from './data-access/invoicing-api';
import { Unit, UnitCategory, UnitUpdate } from './data-access/invoicing-models';
import { INVOICING_ERRORS } from './invoicing-presentation';

const ERRORS: ErrorCatalog = {
  ...INVOICING_ERRORS,
  invoicing_unit_category_mismatch: {
    title: 'Un produit utilise cette unité avec une autre unité.',
    message: 'Changez d’abord les unités de ce produit, puis l’équivalence.',
  },
};

/** A row: the unit and what one of it is worth. */
interface Row {
  readonly unit: Unit;
  /** The first of its family: a line above it. */
  readonly first: boolean;
  /** Other units are worth some of it: renamed only. */
  readonly base: boolean;
  readonly equivalence: string;
  /** Its base unit, and how many of it one of this unit is worth. */
  readonly of: Unit | undefined;
  readonly quantity: string;
}

/** The units offered for « = … », by family. */
interface Family {
  readonly id: string;
  readonly name: string;
  readonly units: readonly Unit[];
}

type Editing = { readonly kind: 'new' } | { readonly kind: 'unit'; readonly row: Row };

/** « 1 000 », « 0,001 »: up to six decimals. */
const amount = (factor: number) => formatDecimal(trimDecimalZeros(factor.toFixed(6), 0), 0);

/**
 * Configuration › Unités de mesure (note backend 0047): each unit and what one of it is worth
 * (« 1 Sac = 50 kg »). A unit is created or changed in the list itself: its name, then
 * « 1 <name> = <quantity> <unit> »; without it, a unit apart (« Bonbonne »).
 */
@Component({
  selector: 'alco-units-page',
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    AlcoButton,
    AlcoErrorState,
    AlcoInput,
    AlcoLoading,
    AlcoPageHeader,
  ],
  templateUrl: './units-page.html',
  styleUrl: './units-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnitsPage {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(AlcoToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly canManage = inject(SessionStore).can('invoicing.manage_products');
  protected readonly categories = requestState(() =>
    this.api.unitCategories().pipe(map((page) => page.results)),
  );

  protected readonly editing = signal<Editing | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalid = signal<string | null>(null);

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    quantity: new FormControl('', { nonNullable: true }),
    of: new FormControl('', { nonNullable: true }),
  });
  /** The name typed, in « 1 <name> = ». */
  protected readonly typed = toSignal(this.form.controls.name.valueChanges, { initialValue: '' });

  protected readonly rows = computed<readonly Row[]>(() =>
    (this.categories.value() ?? []).flatMap((category) => this.rowsOf(category)),
  );

  /** The active units, by family; never the unit changed itself. */
  protected readonly families = computed<readonly Family[]>(() => {
    const editing = this.editing();
    const own = editing?.kind === 'unit' ? editing.row.unit.public_id : null;
    return (this.categories.value() ?? [])
      .map((category) => ({
        id: category.public_id,
        name: category.name,
        units: category.units.filter((unit) => unit.status === 'active' && unit.public_id !== own),
      }))
      .filter((family) => family.units.length > 0);
  });

  /** A unit apart may stay so: a new one, or the only one of its family. */
  protected readonly mayStandAlone = computed(() => {
    const editing = this.editing();
    return editing?.kind === 'new' || (editing?.kind === 'unit' && !editing.row.of);
  });

  protected isEdited(row: Row): boolean {
    const editing = this.editing();
    return editing?.kind === 'unit' && editing.row.unit.public_id === row.unit.public_id;
  }

  protected newUnit(): void {
    this.form.reset({ name: '', quantity: '', of: '' });
    this.start({ kind: 'new' });
  }

  protected change(row: Row): void {
    this.form.reset({
      name: row.unit.name,
      quantity: row.of ? row.quantity : '',
      of: row.of?.public_id ?? '',
    });
    this.start({ kind: 'unit', row });
  }

  protected cancel(): void {
    this.editing.set(null);
    this.invalid.set(null);
    this.error.set(null);
  }

  /** Entrée in the row typed: saved (a choice in a list stays a choice). */
  protected onEnter(event: Event): void {
    if (event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    void this.save();
  }

  protected async save(): Promise<void> {
    const editing = this.editing();
    if (!editing || this.saving()) {
      return;
    }
    const request = this.request(editing);
    if (request) {
      await this.run(request, 'Unité enregistrée.');
    }
  }

  protected async setActive(unit: Unit, active: boolean): Promise<void> {
    if (this.saving()) {
      return;
    }
    await this.run(
      this.api.updateUnit(unit.public_id, { status: active ? 'active' : 'inactive' }),
      active ? `« ${unit.name} » réactivée.` : `« ${unit.name} » archivée.`,
    );
  }

  private rowsOf(category: UnitCategory): Row[] {
    const base = category.units.find((unit) => unit.unit_type === 'reference');
    const others = category.units.length > 1;
    return category.units.map((unit, index) => {
      const reference = unit === base;
      return {
        unit,
        first: index === 0,
        base: reference && others,
        equivalence: reference
          ? others
            ? 'Unité de base'
            : '—'
          : `1 ${unit.name} = ${amount(Number(unit.factor))} ${base?.name ?? ''}`,
        of: reference ? undefined : base,
        quantity: trimDecimalZeros(Number(unit.factor).toFixed(6), 0),
      };
    });
  }

  private request(editing: Editing): Observable<unknown> | null {
    const value = this.form.getRawValue();
    const name = value.name.trim();
    const quantity = normalizeDecimalInput(value.quantity.trim());
    if (!name) {
      this.invalid.set('Saisissez le nom de l’unité.');
      return null;
    }
    const base = editing.kind === 'unit' && editing.row.base;
    if (!base && value.of && !(Number(quantity) > 0)) {
      this.invalid.set(`Saisissez combien vaut 1 ${name}.`);
      return null;
    }
    if (!base && !value.of && value.quantity.trim()) {
      this.invalid.set('Choisissez l’unité après la quantité.');
      return null;
    }
    const equivalence = !base && value.of ? { quantity, of: value.of } : {};
    if (editing.kind === 'new') {
      return this.api.createUnit({ name, ...equivalence });
    }
    const changes: UnitUpdate = { name, ...equivalence };
    return this.api.updateUnit(editing.row.unit.public_id, changes);
  }

  private async run(request: Observable<unknown>, done: string): Promise<void> {
    this.invalid.set(null);
    this.error.set(null);
    this.saving.set(true);
    try {
      await firstValueFrom(request);
      this.editing.set(null);
      this.toast.success(done);
      this.categories.reload();
    } catch (failure) {
      const error = toApiError(failure);
      if (error.kind !== 'unauthenticated') {
        this.error.set(toUserError(error, ERRORS));
      }
    } finally {
      this.saving.set(false);
    }
  }

  private start(editing: Editing): void {
    this.invalid.set(null);
    this.error.set(null);
    this.editing.set(editing);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('#unit-name')?.focus());
  }
}
