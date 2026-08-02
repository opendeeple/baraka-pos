export type SessionState =
  | 'opening_control'
  | 'opened'
  | 'closing_control'
  | 'closed'

export interface PosSession {
  id: number
  storeId: number
  terminalId: string
  userId: number
  state: SessionState
  openingBalance: number
  closingBalanceTheoretical?: number
  closingBalanceActual?: number
  variance?: number
  openedAt: string
  closedAt?: string
  createdAt: string
  updatedAt: string
}

export interface OpenSessionRequest {
  storeId: number
  terminalId: string
  openingBalance: number
}

export interface CloseSessionRequest {
  sessionId: number
  closingBalanceActual: number
}

export interface SessionSummary {
  session: PosSession
  totalSales: number
  totalCash: number
  totalCard: number
  totalOther: number
  saleCount: number
  theoreticalCash: number
  variance: number
}
