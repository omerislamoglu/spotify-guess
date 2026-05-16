import { useEffect, useState } from 'react'
import { Zap, Clock } from 'lucide-react'
import { t } from '../../i18n'
import useEnergy from '../../hooks/useEnergy'

/**
 * Format remaining ms into "HH:MM:SS" or "MM:SS" string.
 */
function formatCountdown(ms) {
  if (ms <= 0) return '00:00'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = n => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/**
 * Energy bar — shows current energy with progress bar + cell dots.
 * When energy is depleted, shows a 24-hour countdown to auto-refill.
 * Supports overflow (energy > maxEnergy from diamond purchases).
 */
export default function EnergyBar() {
  const { energy, maxEnergy, refillAt, checkAutoRefill } = useEnergy()
  const [now, setNow] = useState(Date.now())

  // Tick the countdown every second while depleted
  useEffect(() => {
    if (!refillAt) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [refillAt])

  // Auto-refill when countdown reaches 0
  useEffect(() => {
    if (!refillAt) return
    if (now >= refillAt) {
      checkAutoRefill()
    }
  }, [now, refillAt, checkAutoRefill])

  const isOverflow  = energy > maxEnergy
  const displayMax  = isOverflow ? energy : maxEnergy
  const percentage  = Math.min((energy / displayMax) * 100, 100)
  const remaining   = refillAt ? Math.max(0, refillAt - now) : 0
  const isDepleted  = energy === 0 && refillAt

  const barColor =
    energy <= 3 ? 'bg-red-500' :
    energy <= 6 ? 'bg-amber-400' :
    isOverflow  ? 'bg-cyan-400' :
                  'bg-brand-green'

  const glowColor =
    energy <= 3 ? 'shadow-red-500/30' :
    energy <= 6 ? 'shadow-amber-400/30' :
    isOverflow  ? 'shadow-cyan-400/30' :
                  'shadow-brand-green/30'

  const textColor =
    energy <= 3 ? 'text-red-400' :
    isOverflow  ? 'text-cyan-400' :
                  'text-brand-green'

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Zap size={14} className={textColor} />
          <span className="text-xs font-semibold text-white">{t('energy_label')}</span>
        </div>
        <div className="flex items-center gap-2">
          {isDepleted && (
            <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400">
              <Clock size={10} />
              {formatCountdown(remaining)}
            </span>
          )}
          <span className={`text-xs font-bold ${textColor}`}>
            {energy}
            {isOverflow && <span className="ml-1 text-[10px] text-cyan-400/70">{t('energy_overflow')}</span>}
          </span>
        </div>
      </div>

      {/* Progress track */}
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${barColor} shadow-sm ${glowColor}`}
          style={{ width: `${percentage}%` }}
        />
        {/* Refill progress overlay when depleted */}
        {isDepleted && (
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-amber-400/20 transition-all duration-1000"
            style={{ width: `${Math.min(((24 * 60 * 60 * 1000 - remaining) / (24 * 60 * 60 * 1000)) * 100, 100)}%` }}
          />
        )}
      </div>

      {/* Cell dots */}
      <div className="flex justify-between gap-0.5 px-px">
        {Array.from({ length: maxEnergy }, (_, i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
              i < energy ? barColor : 'bg-surface-2'
            }`}
          />
        ))}
      </div>

      {/* Refill message */}
      {isDepleted && (
        <p className="text-center text-[10px] text-amber-400/80">
          {t('energy_recharge', { time: formatCountdown(remaining) })}
        </p>
      )}
    </div>
  )
}
