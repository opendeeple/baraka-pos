import { Router, Request, Response } from 'express'
import { authMiddleware, requireRole } from '../../middleware/auth.middleware'
import {
  listEmployees, getEmployee, createEmployee, updateEmployee,
  setEmployeeStatus, recordSalaryPayment,
} from './employees.service'

const router = Router()
router.use(authMiddleware)
router.use(requireRole('admin', 'manager', 'super_admin'))

router.get('/', async (req: Request, res: Response) => {
  try {
    const { status, search, page } = req.query
    const result = await listEmployees(req.user!.storeId, {
      status: status as string,
      search: search as string,
      page: page ? Number(page) : 1,
    })
    res.json(result)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const employee = await getEmployee(Number(req.params.id), req.user!.storeId)
    if (!employee) return res.status(404).json({ error: 'Not found' })
    res.json(employee)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.post('/', async (req: Request, res: Response) => {
  try {
    const employee = await createEmployee(req.user!.storeId, req.body, req.user!.userId)
    res.status(201).json(employee)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const employee = await updateEmployee(Number(req.params.id), req.user!.storeId, req.body)
    res.json(employee)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.put('/:id/status', async (req: Request, res: Response) => {
  try {
    const employee = await setEmployeeStatus(Number(req.params.id), req.user!.storeId, req.body.status)
    res.json(employee)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

router.post('/:id/salary-payments', async (req: Request, res: Response) => {
  try {
    const record = await recordSalaryPayment(Number(req.params.id), req.user!.storeId, req.body, req.user!.userId)
    res.status(201).json(record)
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed' })
  }
})

export default router
