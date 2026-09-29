import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import {
  ApplicationConfig,
  LOCALE_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { SessionService } from './core/auth/session.service';
import { provideAppConfig } from './core/config/app-config';
import { provideApi } from './core/http/provide-api';
import { AlcoTitleStrategy } from './core/navigation/route-trail';
import { providePrototypeSession } from './features/prototype/prototype-session';

registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppConfig(environment),
    provideApi(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
    ),
    { provide: TitleStrategy, useClass: AlcoTitleStrategy },
    { provide: LOCALE_ID, useValue: 'fr-FR' },
    // The session listens to « not authenticated » answers from the very first request.
    provideAppInitializer(() => void inject(SessionService)),
    // PROTOTYPE — simulated user and permissions, until the Authentication module.
    ...(environment.sessionSource === 'prototype' ? [providePrototypeSession()] : []),
  ],
};
