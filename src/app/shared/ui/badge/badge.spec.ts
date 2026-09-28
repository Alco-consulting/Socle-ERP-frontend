import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { AlcoBadge, BadgeStatus, STATUS_PRESENTATION } from './badge';

@Component({
  imports: [AlcoBadge],
  template: `<alco-badge [status]="status()" [label]="label()" />`,
})
class Host {
  readonly status = signal<BadgeStatus>('validated');
  readonly label = signal('');
}

describe('AlcoBadge', () => {
  async function render(status: BadgeStatus, label = '') {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.status.set(status);
    fixture.componentInstance.label.set(label);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('alco-badge') as HTMLElement;
  }

  it('always shows a text and a pictogram, never the color alone', async () => {
    for (const status of Object.keys(STATUS_PRESENTATION) as BadgeStatus[]) {
      const badge = await render(status);
      expect(badge.textContent?.trim()).toBe(STATUS_PRESENTATION[status].label);
      expect(badge.querySelector('svg')).not.toBeNull();
    }
  });

  it('uses one tone per state, from the central table', async () => {
    const badge = await render('failed');
    expect(badge.classList).toContain('alco-badge--danger');
  });

  it('accepts a feature label for the same state (« Validée »)', async () => {
    const badge = await render('validated', 'Validée');
    expect(badge.textContent?.trim()).toBe('Validée');
    expect(badge.classList).toContain('alco-badge--success');
  });
});
