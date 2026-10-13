import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Observable, Subject, of, throwError } from 'rxjs';

import { AlcoAutocomplete, AutocompleteOption } from './autocomplete';
import { AlcoFormField } from './form-field';

const ACCOUNTS: readonly AutocompleteOption[] = [
  { id: 'a-401', label: '401100', detail: 'Fournisseurs' },
  { id: 'a-411', label: '411100', detail: 'Clients' },
];

@Component({
  imports: [ReactiveFormsModule, AlcoFormField, AlcoAutocomplete],
  template: `
    <alco-form-field label="Compte" [required]="true">
      <alco-autocomplete [formControl]="account" [search]="search" />
    </alco-form-field>
  `,
})
class Host {
  readonly account = new FormControl<AutocompleteOption | null>(null, Validators.required);
  terms: string[] = [];
  answer: () => Observable<readonly AutocompleteOption[]> = () => of(ACCOUNTS);
  readonly search = (term: string) => {
    this.terms.push(term);
    return this.answer();
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('AlcoAutocomplete (server search, ARIA combobox)', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector('input') as HTMLInputElement;
    const type = async (text: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      await wait(300); // the search waits for a pause in typing
      await fixture.whenStable();
    };
    const key = async (name: string) => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: name, cancelable: true }));
      await fixture.whenStable();
    };
    const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role=option]'));
    return { fixture, host: fixture.componentInstance, input, type, key, options };
  }

  it('is a combobox labelled by its field', async () => {
    const { input } = await setup();
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-haspopup')).toBe('listbox');
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(input.id + '-label')?.textContent).toContain('Compte');
  });

  it('asks the server, lists its answers; the keyboard chooses one', async () => {
    const { host, input, type, key, options } = await setup();
    await type('40');
    expect(host.terms).toEqual(['40']);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(options().map((option) => option.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      '401100 — Fournisseurs',
      '411100 — Clients',
    ]);
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    await key('ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(options()[1].id);
    await key('Enter');
    expect(host.account.value).toEqual(ACCOUNTS[1]);
    expect(input.value).toBe('411100');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('a selection field: a click opens the whole list, a second click closes it', async () => {
    const { fixture, host, input, options } = await setup();
    input.click();
    await wait(300);
    await fixture.whenStable();
    expect(host.terms).toEqual(['']);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(options()).toHaveLength(2);
    options()[1].click();
    await fixture.whenStable();
    // Once chosen, a click shows the whole list again, not only the choice.
    input.click();
    await wait(300);
    await fixture.whenStable();
    expect(host.terms).toEqual(['', '']);
    input.click();
    await fixture.whenStable();
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(host.account.value?.id).toBe('a-411');
  });

  it('a click chooses too; typing again forgets the choice', async () => {
    const { host, type, options } = await setup();
    await type('4');
    options()[0].click();
    expect(host.account.value?.id).toBe('a-401');
    await type('4011');
    expect(host.account.value).toBeNull();
  });

  it('a text not chosen is said under the field', async () => {
    const { fixture, host, input, type } = await setup();
    await type('999');
    input.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(host.account.errors?.['format']).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(fixture.nativeElement.textContent).toContain('Choisissez une proposition de la liste.');
  });

  it('nothing found, or the search failed: said, nothing invented', async () => {
    const { fixture, host, type } = await setup();
    host.answer = () => of([]);
    await type('zz');
    expect(document.body.textContent).toContain('Aucun résultat.');
    host.answer = () => throwError(() => new Error('down'));
    await type('zzz');
    expect(document.body.textContent).toContain('La recherche n’a pas abouti.');
    fixture.destroy();
  });

  it('Escape closes the list; a slow answer shows « Recherche… »', async () => {
    const { host, input, type, key } = await setup();
    const slow = new Subject<readonly AutocompleteOption[]>();
    host.answer = () => slow;
    await type('40');
    expect(document.body.textContent).toContain('Recherche…');
    slow.next(ACCOUNTS);
    await key('Escape');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('a value given by the form is shown', async () => {
    const { fixture, host, input } = await setup();
    host.account.setValue(ACCOUNTS[0]);
    await fixture.whenStable();
    expect(input.value).toBe('401100');
    expect(host.account.valid).toBe(true);
  });
});
