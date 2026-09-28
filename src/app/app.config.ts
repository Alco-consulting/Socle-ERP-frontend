import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';

import { routes } from './app.routes';
import { AlcoTitleStrategy } from './core/navigation/route-trail';
import { providePrototypeSession } from './features/prototype/prototype-session';

registerLocaleData(localeFr);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
    ),
    { provide: TitleStrategy, useClass: AlcoTitleStrategy },
    { provide: LOCALE_ID, useValue: 'fr-FR' },
    // PROTOTYPE — simulated user and permissions; replaced by the API session in Module F2.
    providePrototypeSession(),
  ],
};
