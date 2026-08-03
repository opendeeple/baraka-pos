import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, Card, Chip, Input, Row, Screen, toast } from '@baraka/mobile-ui'
import { spacing } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { probePrinter, printReceipt, type PrinterConfig } from '../printing'
import { useAuthStore } from '../platform/authStore'

const TYPES: Array<{ value: PrinterConfig['type']; label: string }> = [
  { value: 'none', label: 'No printer' },
  { value: 'network', label: 'Network (ESC/POS)' },
  { value: 'bluetooth', label: 'Bluetooth' },
  { value: 'sunmi', label: 'Sunmi built-in' },
]

const WIDTHS: Array<32 | 48> = [32, 48]

/** Receipt-printer setup — before this screen, printing was configured
 * nowhere and therefore unreachable for end users. */
export function PrinterSettingsScreen() {
  const { repos } = getServices()
  const store = useAuthStore((s) => s.store)
  const saved = repos.settings.getJson<PrinterConfig>('printer_config')
  const [type, setType] = useState<PrinterConfig['type']>(saved?.type ?? 'none')
  const [address, setAddress] = useState(saved?.address ?? '')
  const [port, setPort] = useState(String(saved?.port ?? 9100))
  const [width, setWidth] = useState<32 | 48>(saved?.width ?? 32)
  const [testing, setTesting] = useState(false)

  function currentConfig(): PrinterConfig {
    return { type, address: address.trim() || undefined, port: Number(port) || 9100, width }
  }

  function save() {
    if (type === 'network' && !address.trim()) {
      toast.error('Enter the printer IP address')
      return
    }
    repos.settings.setJson('printer_config', currentConfig())
    toast.success('Printer settings saved')
  }

  async function testPrint() {
    setTesting(true)
    try {
      const config = currentConfig()
      const reachable = await probePrinter(config)
      if (!reachable) {
        toast.error('Printer not reachable — check the address and power')
        return
      }
      await printReceipt(
        {
          invoiceNumber: 'TEST-0001',
          storeName: store?.name ?? 'BarakaPOS',
          cashierName: 'Printer test',
          timestamp: new Date().toISOString(),
          items: [{ name: 'Test line', quantity: 1, price: 0, discount: 0 }],
          charges: [],
          discount: 0,
          total: 0,
          payments: [],
          change: 0,
          openDrawer: false,
        },
        config
      )
      toast.success('Test receipt sent')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test print failed')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Screen scroll maxWidth={560}>
      <Card>
        <Row label="Printer" value={TYPES.find((t) => t.value === type)?.label ?? '—'} />
      </Card>

      <View style={styles.chips}>
        {TYPES.map((t) => (
          <Chip key={t.value} label={t.label} selected={type === t.value} onPress={() => setType(t.value)} />
        ))}
      </View>

      {type === 'network' && (
        <View style={styles.form}>
          <Input
            label="Printer IP address"
            value={address}
            onChangeText={setAddress}
            placeholder="192.168.1.50"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Input label="Port" value={port} onChangeText={setPort} keyboardType="numeric" helperText="9100 for most ESC/POS printers" />
        </View>
      )}

      {type !== 'none' && (
        <View style={styles.chips}>
          {WIDTHS.map((w) => (
            <Chip
              key={w}
              label={w === 32 ? '58mm (32 cols)' : '80mm (48 cols)'}
              selected={width === w}
              onPress={() => setWidth(w)}
            />
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <Button title="Save" onPress={save} style={styles.flex1} />
        {type !== 'none' && (
          <Button
            title="Test print"
            variant="secondary"
            icon="printer"
            loading={testing}
            onPress={testPrint}
            style={styles.flex1}
          />
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  form: { gap: spacing.sm, marginTop: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xl },
  flex1: { flex: 1 },
})
