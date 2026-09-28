import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AlcoButton } from './button';

@Component({
  imports: [AlcoButton],
  template: `
    <button
      alcoButton
      type="button"
      variant="primary"
      [loading]="loading()"
      loadingLabel="Validation en cours…"
      (click)="clicks = clicks + 1"
    >
      Valider
    </button>
    <button alcoButton type="button" icon="edit" [iconOnly]="true">Modifier</button>
  `,
})
class Host {
  readonly loading = signal(false);
  clicks = 0;
}

describe('AlcoButton', () => {
  it('keeps the native button and its variant class', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.classList).toContain('alco-button--primary');
    expect(button.textContent?.trim()).toBe('Valider');
  });

  it('while loading: disabled, busy, and says what is happening', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.loading.set(true);
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.textContent?.trim()).toBe('Validation en cours…');
    button.click();
    expect(fixture.componentInstance.clicks).toBe(0);
  });

  it('an icon-only button keeps an accessible name', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const button = fixture.nativeElement.querySelectorAll('button')[1] as HTMLButtonElement;
    expect(button.querySelector('.alco-sr-only')?.textContent?.trim()).toBe('Modifier');
  });
});
