import { useState, useEffect } from 'react'
import { fmtUZS } from '../../lib/currency'

interface CustomerDisplayData {
  storeName?: string
  items?: Array<{ name: string; qty: number; price: number; total: number }>
  total?: number
  change?: number
  message?: string
}

export default function CustomerDisplay() {
  const [data, setData] = useState<CustomerDisplayData>({
    storeName: 'Baraka Mini Market',
    message: 'Welcome!',
  })

  useEffect(() => {
    // Listen for updates from main window
    const handleUpdate = (_event: Event) => {
      const customEvent = _event as CustomEvent<CustomerDisplayData>
      setData(customEvent.detail)
    }
    window.addEventListener('customer-display:update', handleUpdate)
    return () => window.removeEventListener('customer-display:update', handleUpdate)
  }, [])

  return (
    <div className="h-screen bg-dark flex flex-col items-center justify-center text-white">
      <div className="text-3xl font-bold text-primary mb-2">{data.storeName}</div>
      {data.message && !data.items?.length && (
        <div className="text-4xl text-gray-400 mt-8">{data.message}</div>
      )}
      {data.items && data.items.length > 0 && (
        <div className="w-full max-w-lg mt-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 border-b border-dark-border">
                <th className="text-left pb-2">Item</th>
                <th className="text-center pb-2">Qty</th>
                <th className="text-right pb-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={i} className="border-b border-dark-card">
                  <td className="py-2">{item.name}</td>
                  <td className="text-center">{item.qty}</td>
                  <td className="text-right">UZS {fmtUZS(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 text-right">
            <div className="text-2xl font-bold text-primary">
              Total: UZS {fmtUZS(data.total ?? 0)}
            </div>
            {data.change !== undefined && data.change > 0 && (
              <div className="text-xl text-green-400">
                Change: UZS {fmtUZS(data.change)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
