import React, { createContext, useContext, useState, useCallback } from 'react'
import { saveAuthSession, clearAuthSession, getStoredUser } from '../../shared/api/auth.api'

interface AuthState {
  isAuth: boolean
  userId: string | null
  login: string | null
}

interface AuthContextType extends AuthState {
  signIn: (token: string, userId: string, login: string) => void
  signOut: () => void
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const stored = getStoredUser()
    const hasToken = !!localStorage.getItem('mmo_token')
    if (stored && hasToken) {
      return { isAuth: true, userId: stored.userId, login: stored.login }
    }
    return { isAuth: false, userId: null, login: null }
  })

  const signIn = useCallback((token: string, userId: string, login: string) => {
    saveAuthSession(token, userId, login)
    setState({ isAuth: true, userId, login })
  }, [])

  const signOut = useCallback(() => {
    clearAuthSession()
    setState({ isAuth: false, userId: null, login: null })
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
