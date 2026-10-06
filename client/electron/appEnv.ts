/// <reference types="vite/client" />

// `--mode demo` builds (client/.env.demo) talk to the demo server. They keep
// their local SQLite under their own userData folder, so a demo install never
// shares a replica with the real app on the same PC.
export const isDemo = import.meta.env.VITE_APP_ENV === 'demo'

export const APP_NAME = isDemo ? 'baraka-pos-demo' : 'baraka-pos'
