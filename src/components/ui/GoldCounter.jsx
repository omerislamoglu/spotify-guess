import { Coins } from 'lucide-react'
import useEnergy from '../../hooks/useEnergy'

/**
 * Compact gold counter — shows the gold icon + current balance.
 * Tapping it opens the shop (via onClick prop).
 */
export default function GoldCounter({ onClick }) {
  const { gold } = useEnergy()

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-1.5 transition-all hover:bg-amber-500/20 active:scale-95"
    >
      <Coins size={12} className="text-amber-400" />
      <span className="text-[11px] font-bold text-amber-400">{gold}</span>
    </button>
  )
}
