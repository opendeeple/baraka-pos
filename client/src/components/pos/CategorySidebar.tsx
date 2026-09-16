import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { LayoutGrid } from 'lucide-react'

interface Category {
  id: number
  name: string
  collection_type: string
}

interface Props {
  selectedCategory: number | null
  onSelect: (id: number | null) => void
}

export default function CategoryBar({ selectedCategory, onSelect }: Props) {
  const { t } = useTranslation()
  const [categories, setCategories] = useState<Category[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI.db
      .query(`SELECT * FROM collections WHERE collection_type='category' AND deleted_at IS NULL ORDER BY sort_order, name`, [])
      .then((rows) => setCategories(rows as Category[]))
  }, [])

  // Redirect vertical mouse-wheel to horizontal scroll
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <div
      ref={scrollRef}
      className="flex gap-2 overflow-x-auto shrink-0 px-3 py-2.5 border-b border-dark-border"
      style={{ scrollbarWidth: 'none' }}
    >
      <button
        onClick={() => onSelect(null)}
        className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap shrink-0 border transition-all ${
          selectedCategory === null
            ? 'bg-primary border-primary text-white shadow-md shadow-primary/20'
            : 'bg-dark-card border-dark-border text-gray-400 active:text-white'
        }`}
      >
        <LayoutGrid size={14} />
        {t('pos.allItems')}
      </button>

      {categories.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id)}
          className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap shrink-0 border transition-all ${
            selectedCategory === cat.id
              ? 'bg-primary border-primary text-white shadow-md shadow-primary/20'
              : 'bg-dark-card border-dark-border text-gray-400 active:text-white'
          }`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  )
}
