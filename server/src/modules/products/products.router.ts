import { Router, Request, Response } from 'express'
import { authMiddleware } from '../../middleware/auth.middleware'
import {
  listProducts, getProductByBarcode, getProductById,
  createProduct, updateProduct, adjustStock,
} from './products.service'

const router = Router()
router.use(authMiddleware)

router.get('/', async (req: Request, res: Response) => {
  try {
    const { search, category_id, page, limit, featured } = req.query
    const result = await listProducts(req.user!.storeId, {
      search: search as string,
      categoryId: category_id ? Number(category_id) : undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 100,
      featured: featured === 'true',
    })
    res.json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/barcode/:barcode', async (req: Request, res: Response) => {
  try {
    const product = await getProductByBarcode(req.params.barcode, req.user!.storeId)
    if (!product) return res.status(404).json({ error: 'Product not found' })
    res.json(product)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const product = await getProductById(Number(req.params.id), req.user!.storeId)
    if (!product) return res.status(404).json({ error: 'Not found' })
    res.json(product)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.post('/', async (req: Request, res: Response) => {
  try {
    const product = await createProduct(req.user!.storeId, req.body)
    res.status(201).json(product)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const product = await updateProduct(Number(req.params.id), req.user!.storeId, req.body)
    res.json(product)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.post('/adjust-stock', async (req: Request, res: Response) => {
  try {
    const { productId, batchId, quantity, reason } = req.body
    const result = await adjustStock(req.user!.storeId, productId, batchId, quantity, reason, req.user!.userId)
    res.json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

export default router
