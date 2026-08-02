export type PaymentMethod =
  | 'Cash'
  | 'Card'
  | 'Click'
  | 'Debt'
  | 'BankTransfer'
  | 'Credit'
  | 'GiftCard'
  | 'MobileMoney'
  | 'LoyaltyPoints'

export type ChargeState =
  | 'NOT_CHARGED'
  | 'PARTIALLY_CHARGED'
  | 'FULLY_CHARGED'

export type TransactionType = 'sale' | 'return' | 'cashin' | 'cashout' | 'credit'

export interface PaymentTransaction {
  id: number
  saleId?: number
  storeId: number
  contactId?: number
  sessionId?: number
  transactionDate: string
  amount: number
  paymentMethod: PaymentMethod
  transactionType: TransactionType
  chargeState: ChargeState
  paymentTerminalRef?: string
  note?: string
  createdAt: string
  updatedAt: string
}

export interface PaymentEntry {
  paymentMethod: PaymentMethod
  amount: number
  note?: string
  paymentTerminalRef?: string
}
