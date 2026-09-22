import { createI18nMiddleware } from 'fumadocs-core/i18n';

export const i18n = createI18nMiddleware({
  languages: ['en', 'ru'],
  defaultLanguage: 'en',
  hideLocale: 'default-locale'
});
