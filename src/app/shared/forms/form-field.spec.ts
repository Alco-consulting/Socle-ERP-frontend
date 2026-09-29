import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';

import { AlcoFormField } from './form-field';
import { AlcoInput } from './input';
import { decimalFormat, inputFormat } from './validators';

@Component({
  imports: [ReactiveFormsModule, AlcoFormField, AlcoInput],
  template: `
    <alco-form-field label="Libellé" hint="Décrit l’opération." [required]="true">
      <input alcoInput [formControl]="label" />
    </alco-form-field>
    <alco-form-field label="Montant">
      <input alcoInput [numeric]="true" [formControl]="amount" />
    </alco-form-field>
  `,
})
class Host {
  readonly label = new FormControl('', { nonNullable: true, validators: Validators.required });
  readonly amount = new FormControl('', { nonNullable: true, validators: decimalFormat(0) });
}

describe('AlcoFormField', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const [labelInput, amountInput] = Array.from(element.querySelectorAll('input'));
    return { fixture, element, labelInput, amountInput, host: fixture.componentInstance };
  }

  it('links the label and the hint to the control', async () => {
    const { element, labelInput } = await setup();
    const label = element.querySelector('label') as HTMLLabelElement;
    expect(label.htmlFor).toBe(labelInput.id);
    expect(labelInput.getAttribute('aria-describedby')).toBe(`${labelInput.id}-hint`);
    expect(labelInput.getAttribute('aria-required')).toBe('true');
  });

  it('shows no error before the user touched the field', async () => {
    const { element, labelInput } = await setup();
    expect(element.querySelector('.error')).toBeNull();
    expect(labelInput.getAttribute('aria-invalid')).toBeNull();
  });

  it('after touch: human message, aria-invalid and aria-describedby on the error', async () => {
    const { fixture, element, labelInput, host } = await setup();
    host.label.markAsTouched();
    host.label.updateValueAndValidity();
    await fixture.whenStable();
    const error = element.querySelector('.error') as HTMLElement;
    expect(error.textContent?.trim()).toBe('Ce champ est obligatoire.');
    expect(labelInput.getAttribute('aria-invalid')).toBe('true');
    expect(labelInput.getAttribute('aria-describedby')).toContain(error.id);
  });

  it('explains the expected amount format', async () => {
    const { fixture, element, host, amountInput } = await setup();
    host.amount.setValue('12,555');
    host.amount.markAsTouched();
    await fixture.whenStable();
    expect(element.textContent).toContain('Saisissez un montant sans décimales');
    expect(amountInput.classList).toContain('alco-num');
  });

  it('a format check carries its own message; empty is left to « required »', () => {
    const country = new FormControl('', {
      validators: inputFormat(/^[A-Z]{2}$/, 'Code pays à 2 lettres.'),
    });
    expect(country.errors).toBeNull();
    country.setValue('Guinée');
    expect(country.errors).toEqual({ format: 'Code pays à 2 lettres.' });
    country.setValue('GN');
    expect(country.errors).toBeNull();
  });
});
