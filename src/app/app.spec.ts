import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

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

  it('states permanently that the prototype data is fictitious', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const banner = (fixture.nativeElement as HTMLElement).querySelector('[role=note]');
    expect(banner?.textContent).toContain('données fictives, aucune donnée comptable réelle');
  });
});
