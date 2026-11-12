import { Component, Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { convertToParamMap } from '@angular/router';

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  PAGE_SIZE_PARAM,
  PageSizePreference,
  listPaging,
  pageSizeOf,
} from './page-size';
import { AlcoPagination } from './pagination';

describe('Taille de page', () => {
  beforeEach(() => localStorage.clear());

  it('20, 40, 50 ou 100 ; 20 par défaut', () => {
    expect(PAGE_SIZES).toEqual([20, 40, 50, 100]);
    expect(DEFAULT_PAGE_SIZE).toBe(20);
  });

  it('seules les tailles proposées sont retenues', () => {
    expect(pageSizeOf('40')).toBe(40);
    expect(pageSizeOf(100)).toBe(100);
    expect(pageSizeOf('25')).toBeNull();
    expect(pageSizeOf('abc')).toBeNull();
    expect(pageSizeOf(null)).toBeNull();
  });

  it('l’adresse prime, sinon la préférence de l’appareil, sinon 20', () => {
    const preference = TestBed.inject(PageSizePreference);
    expect(preference.resolve(null)).toBe(20);
    expect(preference.resolve('50')).toBe(50);
    preference.remember(40);
    expect(preference.resolve(null)).toBe(40);
    expect(preference.resolve('9999')).toBe(40);
    expect(localStorage.getItem('alco.pageSize')).toBe('40');
  });

  it('une préférence enregistrée est reprise au démarrage', () => {
    localStorage.setItem('alco.pageSize', '100');
    expect(TestBed.inject(PageSizePreference).size()).toBe(100);
  });

  it('une préférence enregistrée invalide est ignorée', () => {
    localStorage.setItem('alco.pageSize', '7');
    expect(TestBed.inject(PageSizePreference).size()).toBe(20);
  });

  it('un stockage qui échoue laisse la taille changer, sans erreur', () => {
    const preference = TestBed.inject(PageSizePreference);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('bloqué');
    });
    expect(() => preference.remember(50)).not.toThrow();
    expect(preference.size()).toBe(50);
    vi.restoreAllMocks();
  });

  it('listPaging : la taille de l’adresse, et une nouvelle taille repart de la page 1', () => {
    const params = signal(convertToParamMap({ [PAGE_SIZE_PARAM]: '40' }));
    const paging = runInInjectionContext(TestBed.inject(Injector), () => listPaging(params));
    expect(paging.size()).toBe(40);
    expect(paging.choose(100, 'page')).toEqual({ [PAGE_SIZE_PARAM]: 100, page: null });
    params.set(convertToParamMap({}));
    expect(paging.size()).toBe(100);
  });
});

@Component({
  imports: [AlcoPagination],
  template: `
    <alco-pagination
      [page]="page()"
      [pageSize]="size()"
      [total]="total()"
      [sizes]="sizes()"
      (pageChange)="pages.push($event)"
      (pageSizeChange)="chosen.push($event)"
    />
  `,
})
class Host {
  readonly page = signal(2);
  readonly size = signal(20);
  readonly total = signal(145);
  readonly sizes = signal<readonly number[] | null>(PAGE_SIZES);
  readonly pages: number[] = [];
  readonly chosen: number[] = [];
}

describe('AlcoPagination', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const button = (name: string) =>
      Array.from(element.querySelectorAll('button')).find((item) =>
        item.textContent?.includes(name),
      )!;
    return { fixture, element, host: fixture.componentInstance, button };
  }

  it('dit la plage, la page et le nombre de pages', async () => {
    const { element } = await render();
    expect(element.textContent).toContain('21–40 sur 145');
    expect(element.textContent).toContain('Page 2 sur 8');
  });

  it('première, précédente, suivante, dernière page', async () => {
    const { host, button } = await render();
    button('Première page').click();
    button('Page précédente').click();
    button('Page suivante').click();
    button('Dernière page').click();
    expect(host.pages).toEqual([1, 1, 3, 8]);
  });

  it('propose 20, 40, 50, 100 et émet la taille choisie', async () => {
    const { element, host } = await render();
    const select = element.querySelector<HTMLSelectElement>('select')!;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      '20',
      '40',
      '50',
      '100',
    ]);
    select.value = '50';
    select.dispatchEvent(new Event('change'));
    expect(host.chosen).toEqual([50]);
  });

  it('une seule page : pas de navigation ; sans tailles : pas de choix', async () => {
    const { fixture, element, host } = await render();
    host.total.set(7);
    host.page.set(1);
    host.sizes.set(null);
    await fixture.whenStable();
    expect(element.textContent).toContain('1–7 sur 7');
    expect(element.querySelector('button')).toBeNull();
    expect(element.querySelector('select')).toBeNull();
  });
});
