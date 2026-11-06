import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Button, Card, Chip, Input, Row, Screen, toast, useTheme, Text } from '@baraka/mobile-ui'
import { useTranslation } from '@baraka/mobile-i18n'
import { spacing, type as typeScale } from '@baraka/ui-tokens'
import { getServices } from '../platform/services'
import { probePrinter, printReceipt, type PrinterConfig } from '../printing'
import { useAuthStore } from '../platform/authStore'

const TYPES: Array<{ value: PrinterConfig['type']; key: string }> = [
  { value: 'none', key: 'printer.none' },
  { value: 'network', key: 'printer.network' },
  { value: 'bluetooth', key: 'printer.bluetooth' },
  { value: 'sunmi', key: 'printer.sunmi' },
  { value: 'system', key: 'printer.system' },
]

const WIDTHS: Array<32 | 48> = [32, 48]

/** Receipt-printer setup — before this screen, printing was configured
 * nowhere and therefore unreachable for end users. */
export function PrinterSettingsScreen() {
  const theme = useTheme()
  const { t } = useTranslation()
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
      toast.error(t('printer.enterIp'))
      return
    }
    repos.settings.setJson('printer_config', currentConfig())
    toast.success(t('printer.settingsSaved'))
  }

  async function testPrint() {
    setTesting(true)
    try {
      const config = currentConfig()
      const reachable = await probePrinter(config)
      if (!reachable) {
        toast.error(t('printer.notReachable'))
        return
      }
      await printReceipt(
        {
          invoiceNumber: 'TEST-0001',
          storeName: store?.name ?? 'BarakaPOS',
          cashierName: t('printer.testPrint'),
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
      toast.success(t('printer.testSent'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('printer.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Screen scroll maxWidth={560}>
      <Card>
        <Row label={t('printer.printerLabel')} value={TYPES.find((p) => p.value === type) ? t(TYPES.find((p) => p.value === type)!.key) : '—'} />
      </Card>

      <View style={styles.chips}>
        {TYPES.map((p) => (
          <Chip key={p.value} label={t(p.key)} selected={type === p.value} onPress={() => setType(p.value)} />
        ))}
      </View>

      {type === 'network' && (
        <View style={styles.form}>
          <Input
            label={t('printer.ipAddress')}
            value={address}
            onChangeText={setAddress}
            placeholder="192.168.1.50"
            keyboardType="numeric"
            autoCapitalize="none"
          />
          <Input label={t('printer.port')} value={port} onChangeText={setPort} keyboardType="numeric" helperText={t('printer.portHint')} />
        </View>
      )}

      {type === 'system' && (
        <Text style={[typeScale.sm, { color: theme.textMuted, marginTop: spacing.md }]}>
          {t('printer.systemHint')}
        </Text>
      )}

      {type !== 'none' && (
        <View style={styles.chips}>
          {WIDTHS.map((w) => (
            <Chip
              key={w}
              label={w === 32 ? t('printer.width58') : t('printer.width80')}
              selected={width === w}
              onPress={() => setWidth(w)}
            />
          ))}
        </View>
      )}

      <View style={styles.actions}>
        <Button title={t('common.save')} onPress={save} style={styles.flex1} />
        {type !== 'none' && (
          <Button
            title={t('printer.testPrint')}
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
