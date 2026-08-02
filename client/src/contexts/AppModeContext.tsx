import { createContext, useContext } from 'react'

type AppMode = 'pos' | 'office'
const AppModeContext = createContext<AppMode>('pos')

export const useAppMode = () => useContext(AppModeContext)
export const AppModeProvider = AppModeContext.Provider
