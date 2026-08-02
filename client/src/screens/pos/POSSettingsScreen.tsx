import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Plus, Pencil, Trash2, X, Globe } from 'lucide-react'
import { PosApp, DEFAULT_APPS, APPS_STORAGE_KEY, loadApps, saveApps } from '../../components/pos/AppLauncherBar'

type FormState = { name: string; url: string; color: string }
const BLANK: FormState = { name: '', url: '', color: '#6366F1' }

export default function POSSettingsScreen() {
  const navigate = useNavigate()
  const [apps, setApps] = useState<PosApp[]>(loadApps)
  const [editing, setEditing] = useState<PosApp | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<FormState>(BLANK)
  const [error, setError] = useState('')

  function openAdd() {
    setForm(BLANK)
    setError('')
    setAdding(true)
    setEditing(null)
  }

  function openEdit(app: PosApp) {
    setForm({ name: app.name, url: app.url, color: app.color })
    setError('')
    setEditing(app)
    setAdding(false)
  }

  function closeModal() {
    setAdding(false)
    setEditing(null)
    setError('')
  }

  function submitForm() {
    const name = form.name.trim()
    let url = form.url.trim()
    if (!name) { setError('App name is required'); return }
    if (!url) { setError('URL is required'); return }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url

    let updated: PosApp[]
    if (adding) {
      updated = [...apps, { id: Date.now().toString(), name, url, color: form.color }]
    } else if (editing) {
      updated = apps.map((a) => a.id === editing.id ? { ...a, name, url, color: form.color } : a)
    } else {
      return
    }

    setApps(updated)
    saveApps(updated)
    closeModal()
  }

  function deleteApp(id: string) {
    const updated = apps.filter((a) => a.id !== id)
    setApps(updated)
    saveApps(updated)
    closeModal()
  }

  function restoreDefaults() {
    localStorage.removeItem(APPS_STORAGE_KEY)
    setApps(DEFAULT_APPS)
    saveApps(DEFAULT_APPS)
  }

  const showModal = adding || !!editing

  return (
    <div className="h-screen flex flex-col bg-dark overflow-hidden">
      {/* Header */}
      <div className="h-16 bg-dark-surface border-b border-dark-border flex items-center gap-3 px-4 shrink-0">
        <button
          onClick={() => navigate('/pos')}
          className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-white rounded-xl transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-white font-bold text-lg">POS Settings</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-2xl w-full mx-auto">

        {/* Mini Apps section */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-white font-semibold text-base">Mini Apps</h2>
              <p className="text-gray-500 text-xs mt-0.5">Payment apps and web tools shown in the POS sidebar</p>
            </div>
            <button
              onClick={openAdd}
              className="flex items-center gap-2 h-10 px-4 bg-primary hover:bg-orange-600 text-white font-medium rounded-xl text-sm transition-colors"
            >
              <Plus size={15} />
              Add App
            </button>
          </div>

          {apps.length === 0 ? (
            <div className="bg-dark-surface border border-dark-border rounded-2xl p-8 text-center">
              <Globe size={32} className="text-gray-600 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No apps added yet</p>
              <button onClick={openAdd} className="mt-3 text-primary text-sm hover:underline">Add your first app</button>
            </div>
          ) : (
            <div className="bg-dark-surface border border-dark-border rounded-2xl overflow-hidden">
              {apps.map((app, i) => (
                <div
                  key={app.id}
                  className={`flex items-center gap-4 px-4 py-4 ${i !== apps.length - 1 ? 'border-b border-dark-border' : ''}`}
                >
                  {/* Icon */}
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
                    style={{ backgroundColor: app.color }}
                  >
                    {app.name.slice(0, 2).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold text-sm">{app.name}</p>
                    <p className="text-gray-500 text-xs truncate mt-0.5">{app.url}</p>
                  </div>

                  {/* Edit button */}
                  <button
                    onClick={() => openEdit(app)}
                    className="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-white hover:bg-dark-card rounded-xl transition-colors shrink-0"
                  >
                    <Pencil size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Restore defaults */}
          {apps.length > 0 && (
            <button
              onClick={restoreDefaults}
              className="mt-3 text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Restore default apps
            </button>
          )}
        </div>
      </div>

      {/* Add / Edit modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeModal}
        >
          <div
            className="bg-dark-surface border border-dark-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-white font-bold text-base">{editing ? 'Edit App' : 'Add App'}</h3>
              <button
                onClick={closeModal}
                className="w-9 h-9 flex items-center justify-center text-gray-400 hover:text-white rounded-xl transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Preview */}
            <div className="flex items-center gap-3 bg-dark-card rounded-xl px-4 py-3 mb-5">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-sm font-bold shrink-0"
                style={{ backgroundColor: form.color }}
              >
                {form.name.slice(0, 2).toUpperCase() || '??'}
              </div>
              <div className="min-w-0">
                <p className="text-white font-semibold text-sm truncate">{form.name || 'App Name'}</p>
                <p className="text-gray-500 text-xs truncate">{form.url || 'https://...'}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">App Name</label>
                <input
                  autoFocus
                  className="w-full bg-dark-card border border-dark-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Payme"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">URL</label>
                <input
                  className="w-full bg-dark-card border border-dark-border rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-primary"
                  placeholder="https://payme.uz"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  onKeyDown={(e) => e.key === 'Enter' && submitForm()}
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1.5">Icon Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    className="w-12 h-12 rounded-xl border border-dark-border cursor-pointer bg-transparent p-1"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                  />
                  <span className="text-sm text-gray-400 font-mono">{form.color}</span>
                </div>
              </div>

              {error && (
                <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-1">
                {editing && (
                  <button
                    onClick={() => deleteApp(editing.id)}
                    className="w-12 h-12 flex items-center justify-center border border-red-500/40 text-red-400 hover:bg-red-500/10 rounded-xl transition-colors shrink-0"
                  >
                    <Trash2 size={17} />
                  </button>
                )}
                <button
                  onClick={submitForm}
                  className="flex-1 h-12 bg-primary hover:bg-orange-600 text-white font-semibold rounded-xl text-sm transition-colors"
                >
                  {editing ? 'Save Changes' : 'Add App'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
