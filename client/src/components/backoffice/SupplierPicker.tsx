import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Plus, Truck } from 'lucide-react'
import { Select, Input, Button } from '../ui'
import { saveSupplier } from '../../lib/suppliers'

interface Props {
  value: number | null
  onChange: (id: number | null) => void
}

/** Supplier of an order: pick one, or add a new one in place (name + phone). */
export function SupplierPicker({ value, onChange }: Props) {
  const { t } = useTranslation()
  const [options, setOptions] = useState<Array<{ value: string; label: string }>>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const rows = await window.electronAPI.db.query(
      `SELECT id, name FROM contacts WHERE type IN ('vendor','both') AND deleted_at IS NULL ORDER BY name`, []
    ) as Array<{ id: number; name: string }>
    setOptions([{ value: '', label: t('suppliers.none') }, ...rows.map((r) => ({ value: String(r.id), label: r.name }))])
  }
  useEffect(() => { load() }, [])

  async function add() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const id = await saveSupplier(null, { name, phone, address: '', notes: '' })
      await load()
      onChange(id)
      setAdding(false); setName(''); setPhone('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  if (adding) {
    return (
      <div className="flex items-end gap-2">
        <div className="flex-1"><Input label={t('suppliers.name')} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
        <div className="w-40"><Input label={t('common.phone')} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <Button variant="secondary" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
        <Button onClick={add} loading={saving} disabled={!name.trim()}>{t('common.save')}</Button>
      </div>
    )
  }

  return (
    <div className="flex items-end gap-2">
      <div className="flex-1">
        <label className="text-xs text-gray-400 mb-1 flex items-center gap-1.5"><Truck size={12} /> {t('suppliers.supplier')}</label>
        <Select value={value ? String(value) : ''} onChange={(v) => onChange(v ? Number(v) : null)} options={options} />
      </div>
      <Button variant="secondary" icon={Plus} onClick={() => setAdding(true)}>{t('suppliers.new')}</Button>
    </div>
  )
}
