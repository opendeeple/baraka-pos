export type ProductType = 'simple' | 'reload' | 'service' | 'combo'
export type CollectionType = 'category' | 'brand' | 'tag'

export interface Collection {
  id: number
  collectionType: CollectionType
  name: string
  slug: string
  description?: string
  parentId?: number
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface Product {
  id: number
  storeId: number
  name: string
  description?: string
  sku?: string
  barcode?: string
  imageUrl?: string
  unit?: string
  categoryId?: number
  brandId?: number
  productType: ProductType
  isStockManaged: boolean
  isActive: boolean
  isFeatured: boolean
  alertQuantity?: number
  discount: number
  metaData?: Record<string, unknown>
  createdAt: string
  updatedAt: string
  batches?: ProductBatch[]
  stocks?: ProductStock[]
  category?: Collection
}

export interface ProductBatch {
  id: number
  productId: number
  batchNumber?: string
  expiryDate?: string
  cost: number
  price: number
  discount: number
  isActive: boolean
  isFeatured: boolean
  vendorId?: number
  createdAt: string
  updatedAt: string
  stock?: number
}

export interface ProductStock {
  id: number
  storeId: number
  productId: number
  batchId: number
  quantity: number
  updatedAt: string
}
