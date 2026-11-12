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
import { BackNavigation } from './core/navigation/back-navigation';
import { AlcoTitleStrategy } from './core/navigation/route-trail';
import { provideGlobalSearch } from './core/search/global-search';
import { ThemeService } from './core/theme/theme.service';
import { accountSearch } from './features/accounting/accounts/account-search';
import { partnerSearch } from './features/partners/partner-search';

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
    // The records the global search (Ctrl+K) finds, each domain on its own API.
    provideGlobalSearch(partnerSearch),
    provideGlobalSearch(accountSearch),
    // The session and the company context listen to the HTTP layer from the first request.
    provideAppInitializer(() => {
      inject(SessionService);
      inject(CompanyContextService);
      // The chosen theme applied before the first screen is drawn.
      inject(ThemeService);
      // The back arrow knows the pages seen from the first one.
      inject(BackNavigation);
    }),
  ],
};
