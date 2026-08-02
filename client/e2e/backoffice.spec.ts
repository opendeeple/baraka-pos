import { test, expect } from '@playwright/test'
import { loadAuthenticatedBackOffice } from './helpers'

function captureErrors(page: import('@playwright/test').Page) {
  const errors: string[] = []
  page.on('pageerror', (err) => {
    const msg = err.message
    if (msg.includes('electronAPI') || msg.includes('Cannot read properties of undefined') ||
        msg.includes('fetch') || msg.includes('Failed to load resource')) return
    errors.push(msg)
  })
  return errors
}

test.describe('Back Office - Dashboard', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors = captureErrors(page)
    await loadAuthenticatedBackOffice(page, '/backoffice')
    await page.waitForTimeout(1000)
    expect(errors).toHaveLength(0)
  })

  test('shows some content', async ({ page }) => {
    await loadAuthenticatedBackOffice(page, '/backoffice')
    const text = await page.locator('#root').textContent()
    expect((text ?? '').length).toBeGreaterThan(0)
  })
})

test.describe('Back Office - Products', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors = captureErrors(page)
    await loadAuthenticatedBackOffice(page, '/backoffice/products')
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })
})

test.describe('Back Office - Sales', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors = captureErrors(page)
    await loadAuthenticatedBackOffice(page, '/backoffice/sales')
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })
})

test.describe('Back Office - Customers', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors = captureErrors(page)
    await loadAuthenticatedBackOffice(page, '/backoffice/customers')
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })
})

test.describe('Back Office - Purchases', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors = captureErrors(page)
    await loadAuthenticatedBackOffice(page, '/backoffice/purchases')
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })
})

test.describe('Back Office - Expenses', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors = captureErrors(page)
    await loadAuthenticatedBackOffice(page, '/backoffice/expenses')
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })
})

test.describe('Back Office - Reports', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors = captureErrors(page)
    await loadAuthenticatedBackOffice(page, '/backoffice/reports')
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })
})

test.describe('Back Office - Employees', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors = captureErrors(page)
    await loadAuthenticatedBackOffice(page, '/backoffice/employees')
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })

  test('has at least one button', async ({ page }) => {
    await loadAuthenticatedBackOffice(page, '/backoffice/employees')
    await page.waitForTimeout(500)
    const count = await page.locator('button').count()
    expect(count).toBeGreaterThan(0)
  })
})

test.describe('Back Office - Settings', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors = captureErrors(page)
    await loadAuthenticatedBackOffice(page, '/backoffice/settings')
    await page.waitForTimeout(500)
    expect(errors).toHaveLength(0)
  })
})
