import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, X, RefreshCw } from 'lucide-react'

interface UpdateInfo { version: string; releaseNotes?: string }
interface DownloadProgress { percent: number; bytesPerSecond: number; total: number; transferred: number }

export function UpdateBanner() {
  const { t } = useTranslation()
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const off1 = window.electronAPI.updater.onUpdateAvailable((info) => {
      setUpdateInfo(info as UpdateInfo)
    })
    const off2 = window.electronAPI.updater.onDownloadProgress((p) => {
      setProgress(p)
    })
    const off3 = window.electronAPI.updater.onUpdateDownloaded(() => {
      setProgress(null)
      setDownloaded(true)
    })
    return () => { off1(); off2(); off3() }
  }, [])

  if (!updateInfo || dismissed) return null

  return (
    <div className="bg-blue-600 text-white px-4 py-2 flex items-center gap-3 shrink-0">
      <Download size={14} className="shrink-0" />
      <span className="text-xs flex-1">
        {downloaded
          ? t('common.updateReady', { version: updateInfo.version })
          : progress
          ? t('common.updateDownloading', { version: updateInfo.version, percent: Math.round(progress.percent) })
          : t('common.updateAvailable', { version: updateInfo.version })}
      </span>
      {downloaded ? (
        <button
          onClick={() => window.electronAPI.updater.install()}
          className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
        >
          <RefreshCw size={12} /> {t('common.restartAndUpdate')}
        </button>
      ) : !progress ? (
        <button
          onClick={() => window.electronAPI.updater.download()}
          className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 px-3 py-1 rounded-lg text-xs font-medium transition-colors"
        >
          <Download size={12} /> {t('common.download')}
        </button>
      ) : (
        <div className="w-24 bg-white/20 rounded-full h-1.5">
          <div className="bg-white h-1.5 rounded-full transition-all" style={{ width: `${progress.percent}%` }} />
        </div>
      )}
      {!progress && (
        <button onClick={() => setDismissed(true)} className="text-white/60 hover:text-white ml-1">
          <X size={14} />
        </button>
      )}
    </div>
  )
}
