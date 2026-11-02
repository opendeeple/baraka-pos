import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ru from './locales/ru.json'
import uz from './locales/uz.json'

export { useTranslation } from 'react-i18next'

export type AppLanguage = 'uz' | 'ru' | 'en'

// Same three, same order, as desktop's client/src/i18n/index.ts — one
// shop owner and staff move between both apps, so the choices (and their
// labels) should look identical everywhere.
export const LANGUAGES: Array<{ code: AppLanguage; label: string }> = [
  { code: 'uz', label: "O'zbekcha" },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
]

let initialized = false

/** Call once, before the app's first render — mirrors desktop: starts
 *  synchronously on a default so nothing blocks on a DB read, then
 *  `loadPersistedLanguage` below reconciles with the saved choice. */
export function initI18n(): typeof i18n {
  if (!initialized) {
    i18n.use(initReactI18next).init({
      resources: {
        en: { translation: en },
        ru: { translation: ru },
        uz: { translation: uz },
      },
      lng: 'uz',
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      returnNull: false,
    })
    initialized = true
  }
  return i18n
}

function isAppLanguage(v: string | null | undefined): v is AppLanguage {
  return v === 'uz' || v === 'ru' || v === 'en'
}

/** Reconciles with the device's saved choice — a per-device setting (like
 *  printer_config), never synced: `app_language` is in sync-engine's
 *  RESERVED_SETTINGS, same as desktop, since the language belongs to
 *  whoever is holding this phone, not the store as a whole. */
export function loadPersistedLanguage(settings: { get(key: string): string }): void {
  const saved = settings.get('app_language')
  if (isAppLanguage(saved) && saved !== i18n.language) {
    i18n.changeLanguage(saved).catch(() => {})
  }
}

export function setAppLanguage(settings: { set(key: string, value: string): void }, lang: AppLanguage): void {
  settings.set('app_language', lang)
  i18n.changeLanguage(lang).catch(() => {})
}

export default i18n
