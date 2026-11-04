import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import azCommon from '@/locales/az/common.json';
import enCommon from '@/locales/en/common.json';

// Minimal setup so the shell is already localized; language detection, switcher and lazy
// namespaces are added by the i18n task (#39).
void i18n.use(initReactI18next).init({
  resources: { az: { common: azCommon }, en: { common: enCommon } },
  lng: 'az',
  fallbackLng: 'az',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

export default i18n;
