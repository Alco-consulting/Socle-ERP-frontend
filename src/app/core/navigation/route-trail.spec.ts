import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, TitleStrategy, provideRouter } from '@angular/router';

import { AlcoTitleStrategy, BreadcrumbService } from './route-trail';

@Component({ template: '' })
class Blank {}

describe('route trail (breadcrumb + tab title)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: 'app',
            children: [
              {
                path: 'comptabilite',
                data: { appId: 'accounting' },
                children: [
                  {
                    path: 'ecritures',
                    data: { breadcrumb: 'Écritures' },
                    children: [
                      { path: '', component: Blank },
                      {
                        path: ':id',
                        resolve: { breadcrumb: () => 'EC-2026-000145' },
                        component: Blank,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
        { provide: TitleStrategy, useClass: AlcoTitleStrategy },
      ],
    });
  });

  it('application / screen, without repeating inherited labels', async () => {
    await TestBed.inject(Router).navigateByUrl('/app/comptabilite/ecritures');
    expect(TestBed.inject(BreadcrumbService).items()).toEqual([
      { label: 'Comptabilité', url: '/app/comptabilite' },
      { label: 'Écritures', url: '/app/comptabilite/ecritures' },
    ]);
  });

  it('application / screen / record, with the resolved record number', async () => {
    await TestBed.inject(Router).navigateByUrl('/app/comptabilite/ecritures/proto-001');
    const labels = TestBed.inject(BreadcrumbService)
      .items()
      .map((item) => item.label);
    expect(labels).toEqual(['Comptabilité', 'Écritures', 'EC-2026-000145']);
  });

  it('writes the same trail, most specific first, in the tab title', async () => {
    await TestBed.inject(Router).navigateByUrl('/app/comptabilite/ecritures/proto-001');
    expect(TestBed.inject(Title).getTitle()).toBe(
      'EC-2026-000145 · Écritures · Comptabilité · Alco',
    );
  });
});
