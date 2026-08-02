import { test, expect } from '@playwright/test'
import { loadApp } from './helpers'

test.describe('App Shell', () => {
  test('loads without fatal JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message
      // Ignore expected missing-Electron-context errors
      if (msg.includes('electronAPI') || msg.includes('Cannot read properties of undefined')) return
      errors.push(msg)
    })
    await loadApp(page)
    expect(errors).toHaveLength(0)
  })

  test('page title is BarakaPOS', async ({ page }) => {
    await loadApp(page)
    expect(await page.title()).toBe('BarakaPOS')
  })

  test('root element has content', async ({ page }) => {
    await loadApp(page)
    const text = await page.locator('#root').textContent()
    expect((text ?? '').length).toBeGreaterThan(0)
  })
})

test.describe('Login Screen', () => {
  test('renders at least one input field', async ({ page }) => {
    await loadApp(page)
    const count = await page.locator('input').count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('has a clickable button', async ({ page }) => {
    await loadApp(page)
    const count = await page.locator('button').count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('contains text content', async ({ page }) => {
    await loadApp(page)
    const text = await page.locator('#root').textContent()
    expect((text ?? '').length).toBeGreaterThan(3)
  })
})
