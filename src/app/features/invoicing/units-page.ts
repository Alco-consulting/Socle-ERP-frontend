import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Observable, firstValueFrom, map } from 'rxjs';

import { UserError, toUserError } from '../../core/errors/user-error';
import { toApiError } from '../../core/http/api-error';
import { requestState } from '../../core/http/request-state';
import { SessionStore } from '../../core/session/session.store';
import { AlcoInput } from '../../shared/forms/input';
import { AlcoButton } from '../../shared/ui/button/button';
import { AlcoErrorState } from '../../shared/ui/error-state/error-state';
import { AlcoLoading } from '../../shared/ui/loading/loading';
import { AlcoPageHeader } from '../../shared/ui/page-header/page-header';
import { AlcoToastService } from '../../shared/ui/toast/toast.service';
import { normalizeDecimalInput, trimDecimalZeros } from '../../shared/utils/decimal';
import { InvoicingApi } from './data-access/invoicing-api';
import { Unit, UnitCategory, UnitType } from './data-access/invoicing-models';
import { INVOICING_ERRORS } from './invoicing-presentation';

/** Odoo's words for the type of a unit. */
const TYPE_LABELS: Readonly<Record<UnitType, string>> = {
  reference: 'Unité de référence de la catégorie',
  bigger: 'Plus grande que la référence',
  smaller: 'Plus petite que la référence',
};

/** What is typed: a new category, a new unit of a category, or a unit changed. */
type Editing =
  | { readonly kind: 'category' }
  | { readonly kind: 'new'; readonly category: string }
  | { readonly kind: 'unit'; readonly unit: Unit };

/**
 * Configuration › Unités de mesure, as Odoo's (note backend 0047): each category with its units,
 * the reference first; another unit is bigger or smaller than the reference by its ratio (a bag
 * of 50 kg: bigger, 50). A category, a unit, a new name or ratio are typed in the list itself.
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
  protected readonly typeLabels = TYPE_LABELS;
  protected readonly categories = requestState(() =>
    this.api.unitCategories().pipe(map((page) => page.results)),
  );

  protected readonly editing = signal<Editing | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<UserError | null>(null);
  protected readonly invalid = signal<string | null>(null);

  protected readonly categoryForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    reference: new FormControl('', { nonNullable: true }),
  });
  protected readonly unitForm = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    unit_type: new FormControl<UnitType>('bigger', { nonNullable: true }),
    ratio: new FormControl('', { nonNullable: true }),
  });

  protected ratio(unit: Unit): string {
    return trimDecimalZeros(unit.ratio, 0);
  }

  /** The unit changed in its row, else none. */
  protected isEdited(unit: Unit): boolean {
    const editing = this.editing();
    return editing?.kind === 'unit' && editing.unit.public_id === unit.public_id;
  }

  protected isAdding(category: UnitCategory): boolean {
    const editing = this.editing();
    return editing?.kind === 'new' && editing.category === category.public_id;
  }

  protected newCategory(): void {
    this.categoryForm.reset();
    this.start({ kind: 'category' }, 'category-name');
  }

  protected newUnit(category: UnitCategory): void {
    this.unitForm.reset({ name: '', unit_type: 'bigger', ratio: '' });
    this.start({ kind: 'new', category: category.public_id }, 'unit-name');
  }

  protected change(unit: Unit): void {
    this.unitForm.reset({ name: unit.name, unit_type: unit.unit_type, ratio: this.ratio(unit) });
    this.start({ kind: 'unit', unit }, 'unit-name');
  }

  protected cancel(): void {
    this.editing.set(null);
    this.invalid.set(null);
    this.error.set(null);
  }

  /** Entrée in a row typed: saved (a choice in a list stays a choice). */
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
    const request = editing.kind === 'category' ? this.categoryRequest() : this.unitRequest();
    if (!request) {
      return;
    }
    await this.run(request, 'Enregistré.');
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

  private categoryRequest(): Observable<unknown> | null {
    const value = this.categoryForm.getRawValue();
    if (!value.name.trim() || !value.reference.trim()) {
      this.invalid.set('Saisissez le nom de la catégorie et celui de son unité de référence.');
      return null;
    }
    return this.api.createUnitCategory(value.name.trim(), value.reference.trim());
  }

  private unitRequest(): Observable<unknown> | null {
    const editing = this.editing();
    const value = this.unitForm.getRawValue();
    const ratio = normalizeDecimalInput(value.ratio.trim());
    const reference = editing?.kind === 'unit' && editing.unit.unit_type === 'reference';
    if (!value.name.trim() || (!reference && !(Number(ratio) > 0))) {
      this.invalid.set('Saisissez le nom de l’unité et un ratio supérieur à 0.');
      return null;
    }
    if (editing?.kind === 'new') {
      return this.api.createUnit({
        category: editing.category,
        name: value.name.trim(),
        unit_type: value.unit_type === 'smaller' ? 'smaller' : 'bigger',
        ratio: ratio ?? '',
      });
    }
    if (editing?.kind !== 'unit') {
      return null;
    }
    return this.api.updateUnit(
      editing.unit.public_id,
      reference
        ? { name: value.name.trim() }
        : { name: value.name.trim(), unit_type: value.unit_type, ratio: ratio ?? '' },
    );
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
        this.error.set(toUserError(error, INVOICING_ERRORS));
      }
    } finally {
      this.saving.set(false);
    }
  }

  private start(editing: Editing, field: string): void {
    this.invalid.set(null);
    this.error.set(null);
    this.editing.set(editing);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>(`#${field}`)?.focus());
  }
}
