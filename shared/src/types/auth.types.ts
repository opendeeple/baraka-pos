export type UserRole = 'super_admin' | 'admin' | 'manager' | 'cashier'

export interface AuthUser {
  id: number
  storeId: number
  name: string
  email: string
  username: string
  role: UserRole
}

export interface LoginRequest {
  username: string
  password: string
  storeId?: number
}

export interface LoginResponse {
  token: string
  syncApiKey?: string
  user: AuthUser
  store: {
    id: number
    name: string
    address: string
    phone: string
    salePrefix: string
  }
}
