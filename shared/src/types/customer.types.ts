export type ContactType = 'customer' | 'vendor' | 'both'

export interface Contact {
  id: number
  storeId: number
  name: string
  email?: string
  phone?: string
  whatsapp?: string
  address?: string
  type: ContactType
  balance: number
  loyaltyPointsBalance: number
  notes?: string
  metaData?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
