import { useEffect, useRef } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { Button, useTheme } from '@baraka/mobile-ui'
import { radius, spacing, type as typeScale } from '@baraka/ui-tokens'

interface Props {
  visible: boolean
  onClose: () => void
  onScan: (barcode: string) => void
}

export function BarcodeScannerModal({ visible, onClose, onScan }: Props) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const [permission, requestPermission] = useCameraPermissions()
  // Debounce: the camera fires the same code many times per second.
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  useEffect(() => {
    if (visible && permission && !permission.granted) requestPermission()
  }, [visible, permission?.granted])

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.container}>
        {permission?.granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'upc_a', 'upc_e', 'qr'],
            }}
            onBarcodeScanned={({ data }) => {
              const now = Date.now()
              if (data === lastScan.current.code && now - lastScan.current.at < 2000) return
              lastScan.current = { code: data, at: now }
              onScan(data)
            }}
          />
        ) : (
          <View style={styles.center}>
            <Text style={[typeScale.md, styles.hint, { color: theme.text }]}>
              Camera permission is required to scan barcodes
            </Text>
            <Button title="Grant permission" onPress={requestPermission} />
          </View>
        )}
        <View style={[styles.frame, { borderColor: theme.primary }]} pointerEvents="none" />
        {/* Safe-area aware: sits above the gesture bar on edge-to-edge Android. */}
        <View style={[styles.closeWrap, { bottom: Math.max(insets.bottom, spacing.lg) + spacing.sm }]}>
          <Button title="Done" size="lg" onPress={onClose} style={styles.closeBtn} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  // True black is intentional behind the live camera feed.
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.lg },
  hint: { textAlign: 'center' },
  frame: {
    position: 'absolute', top: '30%', left: '15%', right: '15%', height: 180,
    borderWidth: 2, borderRadius: radius.lg,
  },
  closeWrap: { position: 'absolute', alignSelf: 'center' },
  closeBtn: { paddingHorizontal: spacing.x4l, borderRadius: radius.full },
})
