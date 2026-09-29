import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { App } from './app';

describe('App', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  it('starts with a skip link to the content', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const link = (fixture.nativeElement as HTMLElement).querySelector('.alco-skip-link');
    expect(link?.textContent).toBe('Aller au contenu');
  });

  it('shows no demonstration strip outside the demonstration screens', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelector('[role=note]')).toBeNull();
  });

  it('says on a demonstration screen that its data is fictitious', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'demo', data: { demo: true }, children: [] }])],
    });
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl('/demo');
    await fixture.whenStable();
    const banner = (fixture.nativeElement as HTMLElement).querySelector('[role=note]');
    expect(banner?.getAttribute('aria-label')).toBe('Démonstration');
    expect(banner?.textContent).toContain('données fictives, sans lien avec la société active');
  });
});
