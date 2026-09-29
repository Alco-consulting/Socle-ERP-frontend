import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';

import { SessionService } from '../../core/auth/session.service';
import { CompanyContextService } from '../../core/company/company-context.service';
import { ApiError } from '../../core/http/api-error';
import { provideHttpTesting } from '../../core/http/testing';
import { SessionStore } from '../../core/session/session.store';
import { TEST_COMPANY, openTestSession } from '../../core/session/testing';
import { CompanyChoicePage } from './company-choice';

const A = { ...TEST_COMPANY, id: 'a', name: 'ALCO GUINÉE', legalName: 'Alco Guinée SARL' };
const B = { ...TEST_COMPANY, id: 'b', name: 'Filiale SA', legalName: 'Filiale SA', active: false };

describe('CompanyChoicePage (/societe)', () => {
  let select: ReturnType<typeof vi.fn>;
  let setDefault: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;

  async function render(companies = [A, B], retour: string | null = '/app/comptabilite') {
    select = vi.fn().mockResolvedValue(undefined);
    setDefault = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        ...provideHttpTesting(),
        { provide: CompanyContextService, useValue: { select, setDefault } },
        { provide: SessionService, useValue: { logout: vi.fn().mockResolvedValue(undefined) } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(retour ? { retour } : {}) },
          },
        },
      ],
    });
    openTestSession(TestBed.inject(SessionStore), { companies, activeCompanyId: null });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(CompanyChoicePage);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const buttons = () =>
      Array.from(element.querySelectorAll<HTMLButtonElement>('ul[aria-label] button'));
    return { fixture, element, buttons };
  }

  it('lists the companies the server gives, an inactive one said in words', async () => {
    const { element, buttons } = await render();
    expect(element.querySelector('h1')?.textContent).toBe('Choisissez une société');
    const read = (button: HTMLButtonElement, selector: string) =>
      Array.from(button.querySelectorAll(selector)).map((node) => node.textContent?.trim());
    const [first, second] = buttons();
    expect(read(first, '.company-name, .alco-caption, alco-badge')).toEqual([
      'ALCO GUINÉE',
      'Alco Guinée SARL · GNF',
    ]);
    expect(read(second, '.company-name, .alco-caption, alco-badge')).toEqual([
      'Filiale SA',
      'GNF',
      'Inactive',
    ]);
  });

  it('opens the chosen company, then the page asked (only inside /app)', async () => {
    const { fixture, buttons } = await render();
    buttons()[0].click();
    await fixture.whenStable();
    expect(select).toHaveBeenCalledWith('a');
    expect(setDefault).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/app/comptabilite');
  });

  it('an external return address is never followed', async () => {
    const { fixture, buttons } = await render([A, B], 'https://evil.example');
    buttons()[0].click();
    await fixture.whenStable();
    expect(navigate).toHaveBeenCalledWith('/app');
  });

  it('makes it the default company when asked', async () => {
    const { fixture, element, buttons } = await render();
    const box = element.querySelector<HTMLInputElement>('input[type=checkbox]');
    box!.checked = true;
    box!.dispatchEvent(new Event('change'));
    buttons()[1].click();
    await fixture.whenStable();
    expect(setDefault).toHaveBeenCalledWith('b');
  });

  it('one company at a time: the others wait', async () => {
    const { fixture, buttons } = await render();
    select.mockReturnValue(new Promise(() => undefined));
    buttons()[0].click();
    await fixture.whenStable();
    expect(buttons().every((button) => button.disabled)).toBe(true);
    expect(buttons()[0].getAttribute('aria-busy')).toBe('true');
    expect(buttons()[0].textContent).toContain('Ouverture…');
  });

  it('a company no longer accessible: said, stays on the (refreshed) list', async () => {
    const { fixture, element, buttons } = await render();
    select.mockRejectedValue(new ApiError('forbidden', 403, 'company_access_denied', 'x'));
    buttons()[1].click();
    await fixture.whenStable();
    expect(element.textContent).toContain('La société sélectionnée n’est plus accessible.');
    expect(navigate).not.toHaveBeenCalled();
    expect(buttons()[0].disabled).toBe(false);
  });

  it('an ended session: no message here (the login screen explains)', async () => {
    const { fixture, element, buttons } = await render();
    select.mockRejectedValue(new ApiError('unauthenticated', 403, 'not_authenticated', 'x'));
    buttons()[0].click();
    await fixture.whenStable();
    expect(element.querySelector('[role=alert]')).toBeNull();
  });

  it('no accessible company: said plainly, with a way out', async () => {
    const { element } = await render([]);
    expect(element.textContent).toContain('Aucune société accessible.');
    expect(element.querySelector('input[type=checkbox]')).toBeNull();
    const logout = Array.from(element.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Se déconnecter',
    );
    logout?.click();
    expect(TestBed.inject(SessionService).logout).toHaveBeenCalled();
  });
});
