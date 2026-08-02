import { Package } from 'lucide-react'
import { fmtUZS } from '../../lib/currency'

export interface LocalProduct {
  id: number
  name: string
  barcode?: string
  image_url?: string
  category_id?: number
  is_stock_managed?: number
  is_active?: number
  batch_id?: number
  batchId?: number
  price?: number
  cost?: number
  stock?: number
  alert_quantity?: number
}

interface Props {
  products: LocalProduct[]
  onAddToCart: (product: LocalProduct) => void
}

export default function ProductGrid({ products, onAddToCart }: Props) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-600 gap-3">
        <Package size={48} className="opacity-30" />
        <p className="text-base">No products found</p>
      </div>
    )
  }

  return (
    <div
      className="grid gap-2.5 pb-3"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
    >
      {products.map((product) => (
        <ProductCard
          key={`${product.id}-${product.batchId ?? product.batch_id ?? 0}`}
          product={product}
          onAdd={onAddToCart}
        />
      ))}
    </div>
  )
}

const PLACEHOLDER_COLORS = [
  'bg-orange-500/20', 'bg-blue-500/20', 'bg-green-500/20',
  'bg-purple-500/20', 'bg-pink-500/20', 'bg-yellow-500/20',
  'bg-cyan-500/20', 'bg-red-500/20',
]

function ProductCard({ product, onAdd }: { product: LocalProduct; onAdd: (p: LocalProduct) => void }) {
  const outOfStock = product.stock !== undefined && product.stock <= 0
  const alertQty = product.alert_quantity ?? 5
  const lowStock = product.stock !== undefined && product.stock > 0 && product.stock <= alertQty
  const colorClass = PLACEHOLDER_COLORS[product.id % PLACEHOLDER_COLORS.length]

  return (
    <button
      onClick={() => !outOfStock && onAdd(product)}
      disabled={outOfStock}
      className={`
        flex items-center gap-3 bg-dark-surface border rounded-2xl p-3 text-left
        transition-all active:scale-[0.97]
        ${outOfStock
          ? 'opacity-40 cursor-not-allowed border-dark-border'
          : 'border-dark-border active:border-primary active:bg-dark-card cursor-pointer'
        }
      `}
    >
      {/* Image / color block — left side */}
      <div className={`w-14 h-14 rounded-xl shrink-0 flex items-center justify-center overflow-hidden ${colorClass}`}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <Package size={22} className="text-white/40" />
        )}
      </div>

      {/* Info — right side */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white font-medium leading-snug line-clamp-2 mb-1">
          {product.name}
        </p>
        <div className="flex items-center justify-between gap-1">
          <span className="text-primary font-bold text-sm">
            {fmtUZS(product.price ?? 0)}
          </span>
          {lowStock && (
            <span className="text-yellow-400 text-xs bg-yellow-400/10 px-1.5 py-0.5 rounded-md shrink-0">
              {product.stock} left
            </span>
          )}
          {outOfStock && (
            <span className="text-red-400 text-xs bg-red-400/10 px-1.5 py-0.5 rounded-md shrink-0">
              Out
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
