import { PaymentEntry } from './payment.types'

export type SaleType = 'sale' | 'return' | 'quote'
export type SaleStatus = 'pending' | 'completed' | 'refunded' | 'cancelled' | 'suspended'
export type PaymentStatus = 'pending' | 'partially_paid' | 'fully_paid'
export type ChargeRateType = 'percentage' | 'fixed'
export type ChargeType = 'tax' | 'service_charge' | 'delivery_fee' | 'gratuity' | 'custom'

export interface CartCharge {
  id: number
  name: string
  chargeType: ChargeType
  rateType: ChargeRateType
  rateValue: number
}

export interface CartItem {
  productId: number
  batchId: number
  name: string
  barcode?: string
  imageUrl?: string
  quantity: number
  freeQuantity: number
  unitPrice: number
  unitCost: number
  discount: number
  notes?: string
  isFree: boolean
  maxStock?: number
}

export interface SaleCheckoutRequest {
  syncId: string
  storeId: number
  sessionId: number
  contactId?: number
  saleType: SaleType
  referenceId?: number
  items: CartItem[]
  charges: CartCharge[]
  discount: number
  payments: PaymentEntry[]
  note?: string
  cartSnapshot?: unknown
}

export interface Sale {
  id: number
  syncId: string
  storeId: number
  sessionId: number
  contactId?: number
  userId: number
  invoiceNumber: string
  saleType: SaleType
  referenceId?: number
  saleDate: string
  saleTime: string
  subtotal: number
  discount: number
  totalChargeAmount: number
  totalAmount: number
  amountReceived: number
  changeAmount: number
  profitAmount: number
  status: SaleStatus
  paymentStatus: PaymentStatus
  note?: string
  cartSnapshot?: unknown
  metaData?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface SaleItem {
  id: number
  saleId: number
  itemType: 'product' | 'charge'
  productId?: number
  batchId?: number
  chargeId?: number
  description: string
  quantity: number
  freeQuantity: number
  unitPrice: number
  unitCost: number
  discount: number
  flatDiscount: number
  isFree: boolean
  notes?: string
  createdAt: string
}
