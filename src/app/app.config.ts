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
import { CompanyContextService } from './core/company/company-context.service';
import { provideAppConfig } from './core/config/app-config';
import { provideApi } from './core/http/provide-api';
import { AlcoTitleStrategy } from './core/navigation/route-trail';

registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppConfig(environment),
    provideApi(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled', anchorScrolling: 'enabled' }),
    ),
    { provide: TitleStrategy, useClass: AlcoTitleStrategy },
    { provide: LOCALE_ID, useValue: 'fr-FR' },
    // The session and the company context listen to the HTTP layer from the first request.
    provideAppInitializer(() => {
      inject(SessionService);
      inject(CompanyContextService);
    }),
  ],
};
