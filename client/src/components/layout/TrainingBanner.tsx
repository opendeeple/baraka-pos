import { useEffect, useState } from 'react'
import { FlaskConical } from 'lucide-react'

export function TrainingBanner() {
  const [isTraining, setIsTraining] = useState(false)

  useEffect(() => {
    window.electronAPI.app.isTraining().then(setIsTraining)
  }, [])

  if (!isTraining) return null

  return (
    <div className="bg-yellow-500 text-black px-4 py-1.5 flex items-center justify-center gap-2 shrink-0">
      <FlaskConical size={14} />
      <span className="text-xs font-bold uppercase tracking-wider">
        Training Mode — No data will be synced to the server
      </span>
    </div>
  )
}
