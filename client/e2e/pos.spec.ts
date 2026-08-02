import { test, expect } from '@playwright/test'
import { loadAuthenticatedPOS } from './helpers'

test.describe('POS Screen', () => {
  test('renders without fatal JS errors', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => {
      const msg = err.message
      if (msg.includes('electronAPI') || msg.includes('Cannot read properties of undefined')) return
      errors.push(msg)
    })
    await loadAuthenticatedPOS(page)
    await page.waitForTimeout(1000)
    expect(errors).toHaveLength(0)
  })

  test('renders interactive elements', async ({ page }) => {
    await loadAuthenticatedPOS(page)
    const count = await page.locator('button, input').count()
    expect(count).toBeGreaterThan(0)
  })

  test('has content in root', async ({ page }) => {
    await loadAuthenticatedPOS(page)
    const text = await page.locator('#root').textContent()
    expect((text ?? '').length).toBeGreaterThan(0)
  })

  test('F4 hold shortcut does not throw', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => {
      if (!err.message.includes('electronAPI') && !err.message.includes('Cannot read')) {
        errors.push(err.message)
      }
    })
    await loadAuthenticatedPOS(page)
    await page.keyboard.press('F4')
    await page.waitForTimeout(300)
    expect(errors).toHaveLength(0)
  })

  test('F2 shortcut does not throw', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => {
      if (!err.message.includes('electronAPI') && !err.message.includes('Cannot read')) {
        errors.push(err.message)
      }
    })
    await loadAuthenticatedPOS(page)
    await page.keyboard.press('F2')
    await page.waitForTimeout(300)
    expect(errors).toHaveLength(0)
  })

  test('F5 payment shortcut does not throw', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => {
      if (!err.message.includes('electronAPI') && !err.message.includes('Cannot read')) {
        errors.push(err.message)
      }
    })
    await loadAuthenticatedPOS(page)
    await page.keyboard.press('F5')
    await page.waitForTimeout(300)
    expect(errors).toHaveLength(0)
  })
})
