import { useEffect, useRef, useState } from 'react'
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { colors } from '../theme'

interface Props {
  visible: boolean
  onClose: () => void
  onScan: (barcode: string) => void
}

export function BarcodeScannerModal({ visible, onClose, onScan }: Props) {
  const [permission, requestPermission] = useCameraPermissions()
  // Debounce: the camera fires the same code many times per second.
  const lastScan = useRef<{ code: string; at: number }>({ code: '', at: 0 })

  useEffect(() => {
    if (visible && permission && !permission.granted) requestPermission()
  }, [visible, permission?.granted])

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
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
            <Text style={styles.hint}>Camera permission is required to scan barcodes</Text>
            <TouchableOpacity style={styles.grantBtn} onPress={requestPermission}>
              <Text style={styles.grantText}>Grant permission</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.frame} pointerEvents="none" />
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeText}>Done</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  hint: { color: colors.text, textAlign: 'center' },
  grantBtn: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24 },
  grantText: { color: colors.onPrimary, fontWeight: '700' },
  frame: {
    position: 'absolute', top: '30%', left: '15%', right: '15%', height: 180,
    borderWidth: 2, borderColor: colors.primary, borderRadius: 16,
  },
  closeBtn: {
    position: 'absolute', bottom: 40, alignSelf: 'center', backgroundColor: colors.primary,
    borderRadius: 999, paddingVertical: 14, paddingHorizontal: 40,
  },
  closeText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
})
