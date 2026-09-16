import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import uz from './locales/uz.json'
import ru from './locales/ru.json'

export type AppLanguage = 'en' | 'uz' | 'ru'
export const LANGUAGES: Array<{ code: AppLanguage; label: string }> = [
  { code: 'uz', label: "O'zbekcha" },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
]

const STORAGE_KEY = 'baraka_language'

function readCachedLanguage(): AppLanguage | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'en' || v === 'uz' || v === 'ru' ? v : null
  } catch {
    return null
  }
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    uz: { translation: uz },
    ru: { translation: ru },
  },
  lng: readCachedLanguage() ?? 'uz',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
})

// POS and Office are separate windows sharing one local SQLite file — the
// language setting lives in the shared `settings` table so it's the same
// app-wide, not per-window. i18next inits synchronously above (from the
// localStorage cache, or 'uz') so the first paint isn't blocked on an IPC
// round-trip; this reconciles it with the authoritative DB value shortly
// after. A window already open when the OTHER window changes language picks
// it up on its next restart, not live — same as most desktop apps.
export async function loadPersistedLanguage(): Promise<void> {
  try {
    const rows = (await window.electronAPI.db.query(
      `SELECT meta_value FROM settings WHERE meta_key='app_language'`, []
    )) as Array<{ meta_value: string }>
    const lang = rows[0]?.meta_value as AppLanguage | undefined
    if (lang && (lang === 'en' || lang === 'uz' || lang === 'ru')) {
      if (lang !== i18n.language) await i18n.changeLanguage(lang)
      try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
    }
  } catch {
    // DB not ready yet, or not running inside Electron (e.g. e2e) — keep the
    // cached/default language.
  }
}

export async function setAppLanguage(lang: AppLanguage): Promise<void> {
  await i18n.changeLanguage(lang)
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  const now = new Date().toISOString()
  const existing = (await window.electronAPI.db.query(
    `SELECT id FROM settings WHERE meta_key='app_language'`, []
  )) as Array<{ id: number }>
  if (existing.length) {
    await window.electronAPI.db.exec(
      `UPDATE settings SET meta_value=?, updated_at=? WHERE meta_key='app_language'`, [lang, now]
    )
  } else {
    await window.electronAPI.db.exec(
      `INSERT INTO settings (meta_key,meta_value,created_at,updated_at) VALUES ('app_language',?,?,?)`,
      [lang, now, now]
    )
  }
}

export default i18n
