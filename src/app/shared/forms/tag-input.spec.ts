import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { AlcoTagInput } from './tag-input';

@Component({
  imports: [ReactiveFormsModule, AlcoTagInput],
  template: `<alco-tag-input
    [formControl]="words"
    label="Grilles"
    [suggestions]="['goods_base', 'goods_tax']"
  />`,
})
class Host {
  readonly words = new FormControl<readonly string[]>(['goods_base'], { nonNullable: true });
}

describe('AlcoTagInput', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector<HTMLInputElement>('input')!;
    const type = async (text: string, key?: string) => {
      input.value = text;
      input.dispatchEvent(new Event('input'));
      if (key) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key }));
      }
      await fixture.whenStable();
    };
    return { fixture, element, input, type, host: fixture.componentInstance };
  }

  it('adds a word with Entrée or a comma, once whatever its case', async () => {
    const { host, type } = await setup();
    await type('goods_tax', 'Enter');
    await type('a,b,');
    await type('GOODS_TAX', 'Enter');
    expect(host.words.value).toEqual(['goods_base', 'goods_tax', 'a', 'b']);
  });

  it('removes a word by its × or the last one with Retour arrière', async () => {
    const { host, element, type } = await setup();
    await type('x', 'Enter');
    element.querySelector<HTMLButtonElement>('[aria-label="Retirer goods_base"]')!.click();
    expect(host.words.value).toEqual(['x']);
    await type('', 'Backspace');
    expect(host.words.value).toEqual([]);
  });

  it('proposes only the suggestions not chosen yet, and is named without a field', async () => {
    const { element, input } = await setup();
    const offered = Array.from(element.querySelectorAll('datalist option')).map((option) =>
      option.getAttribute('value'),
    );
    expect(offered).toEqual(['goods_tax']);
    expect(input.getAttribute('aria-label')).toBe('Grilles');
  });
});
