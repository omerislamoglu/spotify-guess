import { useNavigate } from 'react-router-dom'
import { Crown } from 'lucide-react'
import { t } from '../../i18n'
import useGameStore from '../../store/useGameStore'
import Button from '../ui/Button'

const MEDALS = ['🥇', '🥈', '🥉']

export default function ScoreBoard({ players, scores, rounds, hideLeaveButton }) {
  const navigate  = useNavigate()
  const leaveRoom = useGameStore(s => s.leaveRoom)

  const ranked = [...players]
    .map(p => ({ ...p, score: scores?.[p.uid] ?? 0 }))
    .sort((a, b) => b.score - a.score)

  const topScore = ranked[0]?.score ?? 0
  const winners  = ranked.filter(p => p.score === topScore)
  const isDraw   = winners.length > 1

  const handleLeave = () => {
    leaveRoom()
    navigate('/dashboard')
  }

  return (
    <div className="space-y-5 sm:space-y-6">

      {/* Winner / Draw banner */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-green/20 to-surface border border-brand-green/30 p-5 sm:p-6 text-center">
        <p className="text-3xl sm:text-4xl mb-2">{isDraw ? '🤝' : '🏆'}</p>
        <p className="text-base sm:text-lg font-bold text-brand-green">
          {isDraw
            ? t('score_draw')
            : t('score_wins', { name: winners[0]?.displayName })}
        </p>
        <p className="text-sm text-muted mt-0.5">
          {isDraw
            ? t('score_draw_desc', { names: winners.map(w => w.displayName).join(' & '), pts: topScore })
            : t('score_pts', { pts: topScore })}
        </p>
      </div>

      {/* Full ranking */}
      <div className="rounded-2xl bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t('score_final')}</p>
        </div>
        <ul>
          {ranked.map((player, idx) => (
            <li
              key={player.uid}
              className="flex items-center gap-4 px-4 py-3 border-b border-surface-2 last:border-0"
            >
              <span className="text-xl w-7 text-center">
                {MEDALS[idx] ?? `${idx + 1}`}
              </span>
              <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm font-bold text-brand-green">
                {player.displayName?.[0]?.toUpperCase()}
                {player.isPremium && (
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-black shadow-md">
                    <Crown size={8} />
                  </span>
                )}
              </div>
              <span className="flex-1 text-sm font-medium flex items-center gap-1.5">
                {player.displayName}
                {player.isPremium && (
                  <span className="shrink-0 flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-400 to-yellow-400 px-1.5 py-0.5 text-[8px] font-black text-black">
                    PRO
                  </span>
                )}
              </span>
              <span className="text-sm font-bold text-brand-green">
                {player.score} pts
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Round-by-round recap */}
      {rounds?.length > 0 && (
        <div className="rounded-2xl bg-surface overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t('score_recap')}</p>
          </div>
          <ul>
            {rounds.map((round, idx) => {
              const ownerIds = round.ownerIds ?? (round.ownerId ? [round.ownerId] : [])
              const ownerSet = new Set(ownerIds)
              const ownerNames = ownerIds
                .map(id => players.find(p => p.uid === id)?.displayName)
                .filter(Boolean).join(' & ')

              const correct = Object.entries(round.guesses ?? {}).filter(([uid, g]) => {
                if (ownerSet.has(uid)) return false
                const guesses = Array.isArray(g) ? g : [g]
                return guesses.some(id => ownerSet.has(id))
              }).length

              const voterCount = Object.keys(round.guesses ?? {}).filter(
                uid => !ownerSet.has(uid)
              ).length

              return (
                <li key={idx} className="flex items-center gap-3 px-4 py-3 border-b border-surface-2 last:border-0">
                  <span className="text-xs text-muted w-4">{idx + 1}</span>
                  {round.track.albumArt && (
                    <img
                      src={round.track.albumArt}
                      alt=""
                      className="h-9 w-9 rounded-lg object-cover shrink-0"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{round.track.name}</p>
                    <p className="text-xs text-muted">{ownerNames ? t('score_song', { name: ownerNames }) : t('score_unknown')}</p>
                  </div>
                  <span className="text-xs text-muted shrink-0">
                    {t('score_correct', { correct, total: voterCount })}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {!hideLeaveButton && (
        <Button variant="primary" className="w-full" onClick={handleLeave}>
          {t('score_back')}
        </Button>
      )}
    </div>
  )
}
