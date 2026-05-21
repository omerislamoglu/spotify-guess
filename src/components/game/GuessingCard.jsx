import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { t } from '../../i18n'
import { fetchItunesPreview } from '../../services/spotifyService'
import { POINTS_CORRECT_GUESS, POINTS_WRONG_GUESS } from '../../services/gameService'

// ─── CSS Audio Visualizer ─────────────────────────────────────────────────────

const BAR_DELAYS = [0, 0.15, 0.3, 0.45, 0.6]

function AudioVisualizer({ active }) {
  return (
    <div className="flex items-end gap-0.5" style={{ height: '20px' }}>
      {BAR_DELAYS.map((delay, i) => (
        <div
          key={i}
          className="w-1.5 rounded-full bg-brand-green"
          style={
            active
              ? { animation: `eq-bar 0.7s ease-in-out infinite ${delay}s` }
              : { height: '4px', transition: 'height 0.2s' }
          }
        />
      ))}
    </div>
  )
}

// ─── GuessingCard ─────────────────────────────────────────────────────────────

export default function GuessingCard({
  round,
  players,
  currentUserId,
  isHost,
  roundIndex,
  isLastRound,
  onGuess,
  onReveal,
  onAdvance,
}) {
  const audioRef                          = useRef(null)
  const [isPlaying,      setIsPlaying]    = useState(false)
  const [revealed,       setRevealed]     = useState(false)
  const [advanceCount,   setAdvanceCount] = useState(4)
  const [previewUrl,     setPreviewUrl]   = useState(round.track.previewUrl)
  const [previewStatus,  setPreviewStatus] = useState(
    round.track.previewUrl ? 'ready' : 'searching'
  )
  const [selected,       setSelected]     = useState(new Set())
  const [progressPulse,  setProgressPulse] = useState(false)
  const toastFiredRef                     = useRef(false)
  const prevGuessedCountRef               = useRef(0)

  // Backward compat: ownerIds (new) or [ownerId] (old)
  const ownerIds = round.ownerIds ?? (round.ownerId ? [round.ownerId] : [])
  const ownerSet = new Set(ownerIds)

  const isOwner    = ownerSet.has(currentUserId)
  const myGuess    = round.guesses?.[currentUserId]
  const hasGuessed = myGuess != null

  // Parse guess — could be array (new) or string (old)
  const myGuesses  = Array.isArray(myGuess) ? myGuess : myGuess ? [myGuess] : []

  // Track info stays hidden when a preview is unavailable; that round is skipped.
  const infoVisible = hasGuessed || revealed

  const voters   = players.filter(p => !ownerSet.has(p.uid))
  const allVoted = voters.length > 0 && voters.every(p => round.guesses?.[p.uid] != null)
  const voterCount = Math.max(0, players.length - ownerIds.length)
  const guessedCount = Object.keys(round.guesses ?? {}).filter(uid => !ownerSet.has(uid)).length

  // ── Sync revealed from Firestore with a small delay for CSS transition ──────
  useEffect(() => {
    if (round.revealed && !revealed) {
      const t = setTimeout(() => setRevealed(true), 80)
      return () => clearTimeout(t)
    }
    if (!round.revealed) {
      setRevealed(false)
      toastFiredRef.current = false
    }
  }, [round.revealed]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toast on reveal ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (revealed && !toastFiredRef.current && !isOwner) {
      toastFiredRef.current = true
      const correctCount = myGuesses.filter(g => ownerSet.has(g)).length
      const wrongCount   = myGuesses.filter(g => !ownerSet.has(g)).length
      const correctPts   = correctCount * POINTS_CORRECT_GUESS
      const wrongPts     = wrongCount * Math.abs(POINTS_WRONG_GUESS)
      const pts          = correctPts - wrongPts

      if (correctCount > 0 && wrongCount === 0) {
        toast.success(t('game_perfect', { pts }), { duration: 4000 })
      } else if (pts > 0) {
        toast.success(t('game_partial', { pts, correct: correctCount, wrong: wrongCount }), { duration: 4000 })
      } else if (correctCount > 0) {
        // Had correct picks but too many wrong ones cancelled them out
        toast(t('game_zero_detail', { correctPts, wrongPts }), { duration: 4000 })
      } else if (myGuesses.length > 0) {
        const ownerNames = ownerIds
          .map(id => players.find(p => p.uid === id)?.displayName)
          .filter(Boolean).join(' & ')
        toast.error(t('game_wrong', { names: ownerNames }))
      }
    }
  }, [revealed]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stop audio on reveal ────────────────────────────────────────────────────
  useEffect(() => {
    if (round.revealed) {
      audioRef.current?.pause()
      setIsPlaying(false)
    }
  }, [round.revealed])

  // ── Auto-advance countdown visual ──────────────────────────────────────────
  useEffect(() => {
    if (!revealed) {
      setAdvanceCount(4)
      return
    }

    setAdvanceCount(4)
    const interval = setInterval(() => {
      setAdvanceCount(count => Math.max(1, count - 1))
    }, 1000)
    return () => clearInterval(interval)
  }, [revealed, round.track.id])

  // ── Reset on round change ───────────────────────────────────────────────────
  useEffect(() => {
    setIsPlaying(false)
    setSelected(new Set())
    prevGuessedCountRef.current = 0
    return () => { audioRef.current?.pause() }
  }, [round.track.id])

  // ── Pulse live guess progress when another voter locks in ──────────────────
  useEffect(() => {
    if (guessedCount > prevGuessedCountRef.current) {
      setProgressPulse(true)
      const timeout = setTimeout(() => setProgressPulse(false), 420)
      prevGuessedCountRef.current = guessedCount
      return () => clearTimeout(timeout)
    }
    prevGuessedCountRef.current = guessedCount
  }, [guessedCount])

  // ── Resolve preview URL (Spotify first, iTunes fallback) ────────────────────
  useEffect(() => {
    if (round.track.previewUrl) {
      setPreviewUrl(round.track.previewUrl)
      setPreviewStatus('ready')
      return
    }
    setPreviewUrl(null)
    setPreviewStatus('searching')
    fetchItunesPreview(round.track.artists, round.track.name).then(url => {
      setPreviewUrl(url)
      setPreviewStatus(url ? 'ready' : 'unavailable')
    })
  }, [round.track.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load audio when previewUrl changes (iOS WKWebView needs explicit load) ──
  useEffect(() => {
    if (previewUrl && audioRef.current) {
      audioRef.current.src = previewUrl
      audioRef.current.load()
    }
  }, [previewUrl])

  // ── Try autoplay after the first round (host only) ─────────────────────────
  useEffect(() => {
    if (!isHost || roundIndex <= 0 || previewStatus !== 'ready' || !audioRef.current || round.revealed) return
    audioRef.current.play()
      .then(() => setIsPlaying(true))
      .catch(() => {})
  }, [isHost, previewStatus, roundIndex, round.revealed, round.track.id])

  // ── Audio toggle ────────────────────────────────────────────────────────────
  const togglePlay = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          toast.error(t('game_no_preview'))
          setIsPlaying(false)
        })
    }
  }

  // ── Selection toggle (multi-select) ─────────────────────────────────────────
  const toggleSelect = (uid) => {
    if (hasGuessed || isOwner || round.revealed) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  // ── Lock in guess ───────────────────────────────────────────────────────────
  const lockIn = () => {
    if (selected.size === 0) return
    onGuess([...selected])
  }

  // ── Button style ────────────────────────────────────────────────────────────
  const guessButtonClass = (playerUid) => {
    const isCorrectOwner = revealed && ownerSet.has(playerUid)
    const isMyPick       = myGuesses.includes(playerUid)
    const isWrong        = revealed && isMyPick && !isCorrectOwner
    const isSelected     = selected.has(playerUid)

    if (isCorrectOwner) return 'border-brand-green bg-brand-green/20 text-brand-green'
    if (isWrong)        return 'border-red-500/60 bg-red-900/20 text-red-400'
    if (isMyPick && !revealed) return 'border-brand-green/60 bg-brand-green/10 text-white'
    if (isSelected) return 'border-brand-green/60 bg-brand-green/10 text-white'
    return 'border-surface-2 bg-surface-2/80 text-white hover:border-brand-green/40 hover:bg-surface-2'
  }

  return (
    <div className="space-y-4 sm:space-y-5">

      {/* ── Album art ��─────────────────────────��───────────────────────────── */}
      <div className="relative mx-auto h-36 w-36 sm:h-48 sm:w-48 overflow-hidden rounded-2xl shadow-2xl">
        {round.track.albumArt ? (
          <img
            src={round.track.albumArt}
            alt="Album art"
            className="h-full w-full object-cover"
            style={{
              filter:     infoVisible ? 'none' : 'blur(20px) brightness(0.45)',
              transform:  infoVisible ? 'scale(1.0)' : 'scale(1.08)',
              transition: 'filter 0.7s ease, transform 0.7s ease',
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded-2xl bg-surface-2 text-6xl">
            🎵
          </div>
        )}
        {!infoVisible && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
            <span className="text-3xl">🔒</span>
            <span className="text-xs font-semibold text-white/70">{t('game_whose_song')}</span>
          </div>
        )}
      </div>

      {/* ── Track info (visible after guess or reveal) ──────────────────────── */}
      <div
        className="text-center transition-all duration-500"
        style={{
          opacity:   infoVisible ? 1 : 0,
          transform: infoVisible ? 'translateY(0)' : 'translateY(-6px)',
          pointerEvents: infoVisible ? 'auto' : 'none',
        }}
      >
        <p className="text-base sm:text-lg font-bold leading-tight truncate px-2">{round.track.name}</p>
        <p className="text-sm text-muted">{round.track.artists}</p>
        {revealed && (
          <p className="mt-1 text-xs font-semibold text-brand-green">
            {t('game_from_playlist', { names: ownerIds.map(id => players.find(p => p.uid === id)?.displayName).filter(Boolean).join(' & ') })}
          </p>
        )}
      </div>

      {/* ── Audio player ───────────────────────────────────────────────────── */}
      {isHost && (
        <audio
          ref={audioRef}
          onEnded={() => setIsPlaying(false)}
          playsInline
          preload="auto"
        />
      )}

      <div className="flex items-center justify-center gap-4">
        {previewStatus === 'searching' ? (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-green border-t-transparent" />
          </div>
        ) : previewStatus === 'unavailable' ? (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-2xl">
            🔇
          </div>
        ) : isHost ? (
          <button
            onClick={togglePlay}
            className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-green text-black shadow-lg transition-all hover:brightness-110 active:scale-95"
            aria-label={isPlaying ? t('game_aria_pause') : t('game_aria_play')}
          >
            {isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" className="translate-x-0.5" />}
          </button>
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2">
            <AudioVisualizer active={isPlaying} />
          </div>
        )}

        <div className="w-28">
          {previewStatus === 'searching' && (
            <span className="text-xs text-muted">{t('game_finding_clip')}</span>
          )}
          {previewStatus === 'unavailable' && (
            <span className="text-xs text-muted">{t('game_no_preview')}</span>
          )}
          {previewStatus === 'ready' && (
            isPlaying ? <AudioVisualizer active /> : (
              <span className="text-xs text-muted">
                {isHost
                  ? (roundIndex === 0 ? t('game_play_to_start') : t('game_preview'))
                  : t('game_waiting_host')}
              </span>
            )
          )}
        </div>
      </div>

      {!revealed && (
        <p
          className={`text-center text-xs text-muted transition-transform duration-300 ${
            progressPulse ? 'scale-105 text-brand-green' : 'scale-100'
          }`}
        >
          {t('game_progress', { done: guessedCount, total: voterCount })}
        </p>
      )}

      {/* ── Divider ─────────────────────────────────────────────────────────── */}
      <div className="border-t border-surface-2" />

      {revealed && (
        <div className="flex items-center justify-center gap-3 rounded-xl border border-surface-2 px-4 py-3 text-sm text-muted">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{
              background: `conic-gradient(rgb(29 185 84) ${(advanceCount / 4) * 360}deg, rgb(40 40 40) 0deg)`,
            }}
          >
            {advanceCount}
          </span>
          <span>{t('game_auto_next', { count: advanceCount })}</span>
        </div>
      )}

      {/* ── Owner waiting state ────────────────────────────────────────────── */}
      {isOwner && !revealed && (
        <div className="rounded-xl bg-surface-2 px-4 py-3 text-center">
          <p className="text-sm font-medium">{t('game_your_song')}</p>
          <p className="mt-0.5 text-xs text-muted">{t('game_sit_tight')}</p>
        </div>
      )}

      {/* ── Guess buttons (multi-select) ───────────────────────────────────── */}
      {!isOwner && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            {revealed
              ? t('game_results')
              : hasGuessed
                ? t('game_your_guess')
                : t('game_select_prompt')}
          </p>

          {players.map(player => {
            const guesserCount = Object.values(round.guesses ?? {}).reduce((n, g) => {
              const arr = Array.isArray(g) ? g : [g]
              return n + (arr.includes(player.uid) ? 1 : 0)
            }, 0)

            const isSelected = selected.has(player.uid)
            const isPicked   = myGuesses.includes(player.uid)

            return (
              <button
                key={player.uid}
                onClick={() => toggleSelect(player.uid)}
                disabled={hasGuessed || revealed}
                className={`flex min-h-[52px] w-full items-center justify-between rounded-2xl border px-4 py-3 text-sm font-semibold transition-all active:scale-[0.97] disabled:cursor-default ${guessButtonClass(player.uid)}`}
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                    isSelected || isPicked ? 'bg-brand-green/30' : 'bg-black/30'
                  }`}>
                    {(isSelected || isPicked) && !revealed
                      ? '✓'
                      : player.displayName?.[0]?.toUpperCase()}
                  </span>
                  <span className="truncate">{player.displayName}</span>
                </span>

                {revealed ? (
                  ownerSet.has(player.uid) ? (
                    <span className="ml-2 shrink-0 text-xs font-semibold text-brand-green">{t('game_owner')}</span>
                  ) : null
                ) : hasGuessed && guesserCount > 0 ? (
                  <span className="ml-2 shrink-0 text-xs text-muted">
                    {t('game_votes', { count: guesserCount })}
                  </span>
                ) : null}
              </button>
            )
          })}

          {/* Lock-in button */}
          {!hasGuessed && !revealed && (
            <button
              onClick={lockIn}
              disabled={selected.size === 0}
              className={`flex min-h-[48px] w-full items-center justify-center gap-2 rounded-2xl text-sm font-semibold transition-all active:scale-[0.98] ${
                selected.size > 0
                  ? 'bg-brand-green text-black hover:brightness-110'
                  : 'border border-surface-2 text-muted cursor-not-allowed'
              }`}
            >
              <Lock size={14} />
              {selected.size === 0
                ? t('game_select_one')
                : t('game_lock_in', { count: selected.size })}
            </button>
          )}

          {hasGuessed && !revealed && (
            <p className="pt-1 text-center text-xs text-brand-green">
              {t('game_locked')}
            </p>
          )}
        </div>
      )}

      {/* ── Host controls ──────────────────────────────────────────────────── */}
      {isHost && (
        <div className="space-y-2 pt-1">
          {!revealed ? (
            <button
              onClick={onReveal}
              className={`flex min-h-[52px] w-full items-center justify-center rounded-2xl text-sm font-semibold transition-all active:scale-[0.98] ${
                allVoted
                  ? 'bg-brand-green text-black hover:brightness-110'
                  : 'border border-surface-2 text-muted hover:border-muted hover:text-white'
              }`}
            >
              {allVoted ? t('game_reveal') : t('game_force_reveal')}
            </button>
          ) : (
            <button
              onClick={onAdvance}
              className="flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-brand-green text-sm font-semibold text-black transition-all hover:brightness-110 active:scale-[0.98]"
            >
              {isLastRound ? t('game_see_scores') : t('game_next_round')}
            </button>
          )}
        </div>
      )}

      {!isHost && revealed && (
        <p className="text-center text-xs text-muted">
          {isLastRound ? t('game_over') : t('game_waiting_host')}
        </p>
      )}
    </div>
  )
}
