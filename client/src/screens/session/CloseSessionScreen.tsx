import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useSessionStore } from '../../store/session.store'
import { useAuthStore } from '../../store/auth.store'
import { fmtUZS } from '../../lib/currency'
import { cashFlowRows, methodLabel, shiftReportDoc } from '../../lib/shiftReport'
import { logAudit } from '../../lib/audit'
import { NumPad } from '../../components/pos/NumPad'
import { ArrowLeft, TrendingUp, ShoppingBag, Printer, RotateCcw } from 'lucide-react'
import type { SessionReport } from '../../types/electron'

/**
 * Closing the till: the full shift report (sales, refunds, per payment
 * method, every cash movement in and out of the drawer) next to the cash
 * count. The expected figure comes from the same main-process report the
 * close stores, so the screen, the stored variance and the printed Z report
 * never disagree. X prints the same report mid-shift without closing.
 */
export default function CloseSessionScreen() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { session, clearSession } = useSessionStore()
  const { store } = useAuthStore()
  const [actualCash, setActualCash] = useState('0')
  const [report, setReport] = useState<SessionReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [printingX, setPrintingX] = useState(false)

  useEffect(() => {
    if (session) window.electronAPI.session.report(session.id).then(setReport)
  }, [session?.id])

  async function printX() {
    if (!session) return
    setPrintingX(true)
    try {
      const fresh = await window.electronAPI.session.report(session.id)
      setReport(fresh)
      const res = await window.electronAPI.printer.printReport(shiftReportDoc(t, fresh, 'X', store?.name ?? ''))
      if (!res.success) toast.error(res.error ?? t('shift.printFailed'))
    } finally { setPrintingX(false) }
  }

  async function handleClose() {
    if (!session) return
    setLoading(true)
    try {
      const counted = Number(actualCash)
      await window.electronAPI.session.close({ sessionId: session.id, closingBalanceActual: counted })
      if (report) {
        await logAudit('shift_close', {
          entity: 'session', entityId: session.id,
          details: { expected: report.expectedCash, counted, variance: counted - report.expectedCash, sales: report.salesTotal },
        })
      }
      // Z report after the close, from the stored figures; a printer problem
      // must not keep the till from closing.
      window.electronAPI.session.report(session.id)
        .then((final) => window.electronAPI.printer.printReport(shiftReportDoc(t, final, 'Z', store?.name ?? '', counted)))
        .catch(() => {})
      clearSession()
      navigate('/session/open')
    } finally {
      setLoading(false)
    }
  }

  const variance = report ? Number(actualCash) - report.expectedCash : 0
  const variancePositive = variance >= 0

  return (
    <div className="h-screen bg-dark flex overflow-hidden">
      {/* Left panel — shift report */}
      <div className="flex flex-col w-[440px] shrink-0 bg-dark-surface border-r border-dark-border">
        <div className="p-5 border-b border-dark-border flex items-center gap-3 shrink-0">
          <button
            onClick={() => navigate('/pos')}
            className="w-10 h-10 rounded-lg border border-dark-border flex items-center justify-center text-gray-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-white font-bold text-lg leading-tight">{t('session.closeRegister')}</h1>
            <p className="text-xs text-gray-500">{t('session.sessionSummary')}</p>
          </div>
          <button
            onClick={printX}
            disabled={printingX || !report}
            className="flex items-center gap-1.5 h-10 px-3 rounded-lg border border-dark-border text-gray-300 hover:text-white text-xs disabled:opacity-40"
          >
            <Printer size={14} /> {t('shift.printX')}
          </button>
        </div>

        {report ? (
          <div className="p-5 space-y-4 flex-1 min-h-0 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <Kpi icon={<ShoppingBag size={14} className="text-primary" />} label={t('shift.saleCount')} value={String(report.saleCount)} />
              <Kpi icon={<TrendingUp size={14} className="text-green-400" />} label={t('shift.salesTotal')} value={fmtUZS(report.salesTotal)} />
            </div>
            {(report.returnCount > 0 || report.cancelledCount > 0) && (
              <p className="flex items-center gap-2 text-xs text-gray-400">
                <RotateCcw size={13} /> {t('shift.returnsAndVoids', { returns: report.returnCount, voids: report.cancelledCount })}
              </p>
            )}

            <Section title={t('shift.byMethod')}>
              {report.byMethod.length === 0 && <Row label="—" value="" />}
              {report.byMethod.map((m) => <Row key={m.method} label={methodLabel(t, m.method)} value={`${fmtUZS(m.amount)} UZS`} />)}
            </Section>

            <Section title={t('shift.cashFlow')}>
              {cashFlowRows(t, report).map((row) => (
                <Row key={row.label} label={`${row.sign ? row.sign + ' ' : ''}${row.label}`} value={`${fmtUZS(row.amount)} UZS`} />
              ))}
              <Row label={t('shift.expected')} value={`${fmtUZS(report.expectedCash)} UZS`} strong />
            </Section>

            {Number(actualCash) > 0 && (
              <div className={`rounded-2xl p-4 border ${variancePositive ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
                <div className="flex justify-between items-center">
                  <span className={`text-sm font-semibold ${variancePositive ? 'text-green-400' : 'text-red-400'}`}>
                    {variancePositive ? t('shift.over') : t('shift.short')}
                  </span>
                  <span className={`text-lg font-bold ${variancePositive ? 'text-green-400' : 'text-red-400'}`}>
                    {variancePositive ? '+' : ''}{fmtUZS(variance)} UZS
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">{t('session.loadingSummary')}</div>
        )}
      </div>

      {/* Right panel — counted cash */}
      <div className="flex-1 min-w-0 overflow-y-auto flex flex-col items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <h2 className="text-xl font-bold text-white mb-1">{t('session.countActualCash')}</h2>
          <p className="text-gray-500 text-sm mb-6">{t('session.enterActualCashHint')}</p>
          <NumPad value={actualCash} onChange={setActualCash} />
          <div className="mt-6 flex gap-3">
            <button
              onClick={() => navigate('/pos')}
              className="flex-1 border border-dark-border text-gray-400 hover:text-white font-medium py-4 rounded-2xl text-sm transition-colors"
            >
              {t('nav.backToPos')}
            </button>
            <button
              onClick={handleClose}
              disabled={loading || !report}
              className="flex-1 bg-red-600 hover:bg-red-700 active:scale-[0.98] disabled:opacity-50 text-white font-bold py-4 rounded-2xl text-sm transition-all"
            >
              {loading ? t('session.closing') : t('session.closeRegister')}
            </button>
          </div>
          <p className="text-xs text-gray-500 text-center mt-3">{t('shift.zPrintsOnClose')}</p>
        </div>
      </div>
    </div>
  )
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-dark-card rounded-2xl p-4 border border-dark-border">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-lg font-bold text-white leading-tight">{value}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-dark-card rounded-2xl border border-dark-border overflow-hidden">
      <div className="px-4 py-3 border-b border-dark-border">
        <span className="text-xs text-gray-500 uppercase tracking-wider">{title}</span>
      </div>
      <div className="px-4 py-2 divide-y divide-dark-border/60">{children}</div>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between py-2 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? 'text-gray-200' : 'text-gray-400'}>{label}</span>
      <span className="text-white">{value}</span>
    </div>
  )
}
