import { useEffect, useRef, useState } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Plus, Search, Edit2, Trash2, Tags } from 'lucide-react'
import { BackOfficeLayout } from '../../components/layout/BackOfficeLayout'
import { Modal, Button, Input, EmptyState, SkeletonRow, PageHeader } from '../../components/ui'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'

interface Category {
  id: number
  name: string
  description: string | null
  product_count: number
}

interface CategoryForm {
  name: string
  description: string
}

const EMPTY_FORM: CategoryForm = { name: '', description: '' }

export default function CategoriesScreen() {
  const { t } = useTranslation()
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null)
  const [deleting, setDeleting] = useState(false)
  const debouncedSearch = useDebouncedValue(search)
  // setSaving/setDeleting only disable the button on the *next* render —
  // rapid clicks before that commits can each run a full extra insert.
  // Refs update synchronously, so this guard blocks the very next click.
  const submittingRef = useRef(false)

  useEffect(() => { loadAll() }, [debouncedSearch])

  async function loadAll() {
    let sql = `
      SELECT c.id, c.name, c.description,
             (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.deleted_at IS NULL) as product_count
      FROM collections c
      WHERE c.collection_type='category' AND c.deleted_at IS NULL`
    const params: unknown[] = []
    if (debouncedSearch.trim()) {
      sql += ` AND c.name LIKE ?`
      params.push(`%${debouncedSearch}%`)
    }
    sql += ` ORDER BY c.name`
    setLoading(true)
    try {
      setCategories(await window.electronAPI.db.query(sql, params) as Category[])
    } finally { setLoading(false) }
  }

  function openCreate() { setEditId(null); setForm(EMPTY_FORM); setShowForm(true) }
  function openEdit(c: Category) {
    setEditId(c.id)
    setForm({ name: c.name, description: c.description ?? '' })
    setShowForm(true)
  }

  async function saveCategory() {
    if (!form.name.trim()) return
    if (submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    const now = new Date().toISOString()
    try {
      if (editId) {
        await window.electronAPI.db.exec(
          `UPDATE collections SET name=?, description=?, updated_at=? WHERE id=?`,
          [form.name.trim(), form.description.trim() || null, now, editId]
        )
        const row = (await window.electronAPI.db.query(
          `SELECT sync_id FROM collections WHERE id=?`, [editId]
        ) as Array<{ sync_id: string }>)[0]
        if (row?.sync_id) await window.electronAPI.sync.enqueue('collections', row.sync_id, 'upsert')
      } else {
        const syncId = uuidv4()
        await window.electronAPI.db.exec(
          `INSERT INTO collections (sync_id, collection_type, name, description, sort_order, created_at, updated_at)
           VALUES (?, 'category', ?, ?, 0, ?, ?)`,
          [syncId, form.name.trim(), form.description.trim() || null, now, now]
        )
        await window.electronAPI.sync.enqueue('collections', syncId, 'upsert')
      }
      window.electronAPI.sync.pushPending().catch(() => {})
      setShowForm(false)
      loadAll()
    } finally { setSaving(false); submittingRef.current = false }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    if (submittingRef.current) return
    submittingRef.current = true
    setDeleting(true)
    const now = new Date().toISOString()
    try {
      const row = (await window.electronAPI.db.query(
        `SELECT sync_id FROM collections WHERE id=?`, [deleteTarget.id]
      ) as Array<{ sync_id: string }>)[0]
      await window.electronAPI.db.exec(
        `UPDATE collections SET deleted_at=?, updated_at=? WHERE id=?`,
        [now, now, deleteTarget.id]
      )
      if (row?.sync_id) await window.electronAPI.sync.enqueue('collections', row.sync_id, 'delete')
      window.electronAPI.sync.pushPending().catch(() => {})
      toast.success(t('categories.deletedToast', { name: deleteTarget.name }))
      setDeleteTarget(null)
      loadAll()
    } finally { setDeleting(false); submittingRef.current = false }
  }

  const f = (k: keyof CategoryForm, v: string) => setForm((prev) => ({ ...prev, [k]: v }))

  return (
    <BackOfficeLayout>
      <PageHeader
        title={t('nav.categories')}
        actions={<Button icon={Plus} onClick={openCreate}>{t('categories.addCategory')}</Button>}
      />

      <div className="shrink-0 px-6 py-3 border-b border-dark-border flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('categories.searchCategories')}
            className="w-full bg-dark-card border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary" />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-dark-surface border-b border-dark-border">
            <tr>{[t('common.name'), t('common.description'), t('nav.products'), ''].map((h) => (
              <th key={h} className="text-left px-4 py-3 text-xs text-gray-400 font-medium uppercase tracking-wider">{h}</th>
            ))}</tr>
          </thead>
          <tbody className="divide-y divide-dark-border">
            {loading && Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} cols={4} />)}
            {!loading && categories.map((c) => (
              <tr key={c.id} className="hover:bg-dark-card/40 group">
                <td className="px-4 py-3 text-white text-sm font-medium">{c.name}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{c.description || '—'}</td>
                <td className="px-4 py-3 text-gray-400 text-sm">{c.product_count}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button onClick={() => openEdit(c)} className="text-gray-500 hover:text-white p-1 rounded">
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => setDeleteTarget(c)} className="text-gray-500 hover:text-red-400 p-1 rounded">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && categories.length === 0 && (
          <EmptyState icon={Tags} title={t('categories.noCategoriesFound')} />
        )}
      </div>

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editId ? t('categories.editCategory') : t('categories.newCategory')}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
            <Button className="flex-1" onClick={saveCategory} loading={saving} disabled={!form.name.trim()}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      >
        <div className="p-5 space-y-3">
          <Input label={t('products.nameRequired')} autoFocus value={form.name} onChange={(e) => f('name', e.target.value)} />
          <Input label={t('common.description')} value={form.description} onChange={(e) => f('description', e.target.value)} />
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title={t('categories.deleteCategory')}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" className="flex-1" onClick={confirmDelete} loading={deleting}>
              {deleting ? t('common.deleting') : t('common.delete')}
            </Button>
          </>
        }
      >
        <div className="p-5 text-sm text-gray-400">
          {t('categories.deleteConfirm', { name: deleteTarget?.name ?? '' })}
          {!!deleteTarget?.product_count && (
            <p className="mt-2 text-yellow-400 text-xs">
              {t('categories.productsUseWarning', { count: deleteTarget.product_count })}
            </p>
          )}
        </div>
      </Modal>
    </BackOfficeLayout>
  )
}
