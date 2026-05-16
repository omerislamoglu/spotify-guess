import { Gem } from 'lucide-react'
import useEnergy from '../../hooks/useEnergy'

/**
 * Compact diamond counter — shows the diamond icon + current balance.
 * Tapping it opens the shop (via onClick prop).
 */
export default function DiamondCounter({ onClick }) {
  const { diamonds } = useEnergy()

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 px-2.5 py-1.5 transition-all hover:bg-cyan-500/20 active:scale-95"
    >
      <Gem size={12} className="text-cyan-400" />
      <span className="text-[11px] font-bold text-cyan-400">{diamonds}</span>
    </button>
  )
}
