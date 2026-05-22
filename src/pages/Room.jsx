import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Share2, Check, Crown } from 'lucide-react'
import toast from 'react-hot-toast'
import useGameStore from '../store/useGameStore'
import useAuthStore from '../store/useAuthStore'
import useEnergyStore from '../store/useEnergyStore'
import { GOLD_PER_WIN, ENERGY_PER_GAME } from '../services/energyService'
import { markGoldAwarded, leaveRoom as fsLeaveRoom, resetToLobby } from '../services/gameService'
import GuessingCard from '../components/game/GuessingCard'
import PlaylistPicker from '../components/game/PlaylistPicker'
import ScoreBoard from '../components/game/ScoreBoard'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { showInterstitial } from '../services/adService'
import { t } from '../i18n'
import { shareRoom } from '../utils/shareRoom'

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand-green border-t-transparent" />
    </div>
  )
}

// ─── Invite / Share button ────────────────────────────────────────────────────

function InviteButton({ code }) {
  const [shared, setShared] = useState(false)

  const handleShare = async () => {
    await shareRoom(code)
    setShared(true)
    setTimeout(() => setShared(false), 2500)
  }

  return (
    <button
      onClick={handleShare}
      className="flex min-h-11 items-center gap-1.5 rounded-full border border-surface-2 px-3 py-2 text-xs font-medium text-muted transition-all hover:border-brand-green/40 hover:text-white active:scale-95"
    >
      {shared
        ? <><Check size={13} className="text-brand-green" /> {t('lobby_copied')}</>
        : <><Share2 size={13} /> {t('lobby_share')}</>}
    </button>
  )
}

// ─── Lobby phase ──────────────────────────────────────────────────────────────

const ROUND_OPTIONS = [3, 5, 7, 10, 15, 20]

function LobbyView({ room, currentUser, isHost, onLeave }) {
  const [pickerToken,   setPickerToken]   = useState(null)
  const [syncing,       setSyncing]       = useState(false)
  const [showTrackList, setShowTrackList] = useState(false)
  const [roundCount,    setRoundCount]    = useState(5)

  const navigate = useNavigate()
  const { connectPlaylist, connectRecentlyPlayed, connectLikedSongs, startGame, loading, preparing, error, clearError } = useGameStore()
  const { ensureFreshToken, spotifyToken }                         = useAuthStore()

  const openPicker = useCallback(async () => {
    const token = await ensureFreshToken()
    if (!token) {
      toast.error(t('error_spotify_session_expired'))
      navigate('/dashboard')
      return
    }
    setPickerToken(token)
  }, [ensureFreshToken, navigate])

  const myPlaylist    = room.playerPlaylists?.[currentUser.uid]
  const connectedUids = Object.keys(room.playerPlaylists ?? {})
  const hasHostPlaylist = Boolean(room.playerPlaylists?.[currentUser.uid])
  const canStart      = isHost && connectedUids.length >= 2 && hasHostPlaylist
  const startDisabledReason = !hasHostPlaylist
    ? t('lobby_need_host_playlist')
    : connectedUids.length < 2
      ? t('lobby_need_players')
      : ''

  const handleSelectPlaylist = async (playlist) => {
    setPickerToken(null)
    setSyncing(true)
    // Re-check freshness in case the token expired while the picker was open
    const token = await ensureFreshToken()
    if (!token) {
      toast.error(t('error_spotify_session_expired'))
      setSyncing(false)
      navigate('/dashboard')
      return
    }
    try {
      await connectPlaylist(token, playlist.id, playlist.name)
      toast.success(`"${playlist.name}" connected!`)
    } catch (err) {
      console.error(err)
      toast.error(t('error_generic'))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 sm:px-5 pt-3 pb-3">
      <div className="mx-auto w-full max-w-md space-y-2">

        {/* Header */}
        <div className="animate-fade-in flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted">{t('lobby_title')}</p>
            <h1 className="text-base sm:text-lg font-bold">{t('lobby_room', { code: room.code })}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <InviteButton code={room.code} />
            <button
              onClick={onLeave}
              className="flex min-h-10 items-center rounded-full border border-surface-2 px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:text-white active:scale-95"
            >
              {t('lobby_leave')}
            </button>
          </div>
        </div>

        {/* Join code — animated floating card */}
        <div
          className="animate-slide-up relative overflow-hidden rounded-xl border border-brand-green/30 bg-gradient-to-br from-brand-green/10 to-brand-green/5 px-4 py-2 text-center"
          style={{ animationDelay: '50ms' }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(30,215,96,0.12),transparent_65%)]" />
          <p className="text-[10px] text-muted">{t('lobby_share_code')}</p>
          <p className="animate-float font-mono text-2xl font-bold tracking-[0.3em] text-brand-green drop-shadow-[0_0_12px_rgba(30,215,96,0.6)]">
            {room.code}
          </p>
        </div>

        {/* Players + playlist status */}
        <div
          className="animate-slide-up overflow-hidden rounded-2xl border border-white/8 bg-white/4"
          style={{ animationDelay: '100ms' }}
        >
          <div className="px-3 pt-2.5 pb-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              {t('lobby_players', { count: room.players.length })}
            </p>
          </div>
          <ul className="space-y-0.5 px-2 pb-2">
            {room.players.map((player, idx) => {
              const pl = room.playerPlaylists?.[player.uid]
              const premium = player.isPremium
              const hasPlaylist = !!pl

              return (
                <li
                  key={player.uid}
                  className="animate-slide-up"
                  style={{ animationDelay: `${140 + idx * 60}ms` }}
                >
                  {/* Premium row — Discord Nitro style */}
                  {premium ? (
                    <div className="animate-nitro-glow relative overflow-hidden rounded-xl border border-amber-400/30 bg-gradient-to-r from-amber-950/60 via-amber-900/30 to-transparent px-2.5 py-1.5">
                      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_30%,rgba(251,191,36,0.06)_50%,transparent_70%)] animate-[shimmer_3s_linear_infinite] bg-[length:200%_auto]" />
                      <div className="flex items-center gap-2">
                        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/40 to-amber-600/25 text-xs font-bold text-amber-200 ring-2 ring-amber-400/60 shadow-[0_0_12px_rgba(251,191,36,0.4)]">
                          {player.displayName?.[0]?.toUpperCase() ?? '?'}
                          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-500 text-black shadow-md">
                            <Crown size={8} />
                          </span>
                        </div>
                        {/* Name area */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="pro-name text-sm font-bold">
                              {player.displayName}
                            </span>
                            {/* PRO chip */}
                            <span className="shrink-0 flex items-center gap-0.5 rounded-full bg-gradient-to-r from-amber-400 to-yellow-400 px-1.5 py-0.5 text-[9px] font-black text-black shadow-[0_0_6px_rgba(251,191,36,0.5)]">
                              <Crown size={7} />
                              PRO
                            </span>
                            {player.uid === room.hostId && (
                              <span className="rounded-full bg-brand-green/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-green">
                                {t('lobby_host')}
                              </span>
                            )}
                          </div>
                          {pl ? (
                            <p className="truncate text-xs font-medium text-brand-green">✓ {pl.playlistName}</p>
                          ) : (
                            <p className="text-xs text-amber-300/40 italic">{t('lobby_no_playlist')}</p>
                          )}
                        </div>
                        {/* Checkmark */}
                        {hasPlaylist && (
                          <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-brand-green/20">
                            <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-brand-green stroke-[3]">
                              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                  <div className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 transition-all ${
                    hasPlaylist
                      ? 'border border-brand-green/20 bg-brand-green/5'
                      : 'border border-white/6 bg-white/3'
                  }`}>
                    <div className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      hasPlaylist
                        ? 'animate-green-pulse bg-gradient-to-br from-brand-green/30 to-brand-green/10 text-brand-green ring-2 ring-brand-green/40'
                        : 'bg-surface-2 text-white/60'
                    }`}>
                      {player.displayName?.[0]?.toUpperCase() ?? '?'}
                    </div>

                    {/* Name + playlist status */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-white">
                          {player.displayName}
                        </p>
                        {player.uid === room.hostId && (
                          <span className="rounded-full bg-brand-green/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-green">
                            {t('lobby_host')}
                          </span>
                        )}
                      </div>
                      {pl ? (
                        <p className="truncate text-xs font-medium text-brand-green">
                          ✓ {pl.playlistName}
                        </p>
                      ) : (
                        <p className="text-xs text-white/35 italic">{t('lobby_no_playlist')}</p>
                      )}
                    </div>

                    {/* Playlist connected checkmark badge */}
                    {hasPlaylist && (
                      <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-brand-green/20">
                        <svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-brand-green stroke-[3]">
                          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    )}
                  </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        {/* My playlist */}
        <div className="animate-slide-up space-y-1.5" style={{ animationDelay: '220ms' }}>
          {myPlaylist ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between rounded-xl border border-brand-green/30 bg-brand-green/10 px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-brand-green">{t('lobby_connected')}</p>
                  <p className="text-xs text-muted">
                    {myPlaylist.playlistName} · {myPlaylist.tracks.length} tracks
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setShowTrackList(v => !v)}
                    className="text-xs text-muted transition-colors hover:text-white"
                  >
                    {showTrackList ? t('lobby_hide') : t('lobby_see_tracks')}
                  </button>
                  <button
                    onClick={() => { setShowTrackList(false); openPicker() }}
                    className="text-xs text-muted transition-colors hover:text-white"
                  >
                    {t('lobby_change')}
                  </button>
                </div>
              </div>

              {/* Collapsible track list */}
              {showTrackList && (
                <div className="max-h-48 overflow-y-auto rounded-xl bg-surface-2 px-3 py-2 space-y-1">
                  {myPlaylist.tracks.map((track, i) => (
                    <div key={track.id ?? i} className="flex items-center gap-2 py-1">
                      {track.albumArt && (
                        <img src={track.albumArt} alt="" className="h-7 w-7 rounded shrink-0 object-cover" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-white">{track.name}</p>
                        <p className="truncate text-xs text-muted">{track.artists}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                variant="secondary"
                className="w-full"
                onClick={openPicker}
                disabled={!spotifyToken || syncing}
              >
                {syncing ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-transparent" />
                    {t('lobby_syncing')}
                  </>
                ) : (
                  t('lobby_connect_playlist')
                )}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                disabled={!spotifyToken || syncing}
                onClick={async () => {
                  setSyncing(true)
                  const token = await ensureFreshToken()
                  if (!token) { toast.error(t('error_spotify_session_expired')); setSyncing(false); return }
                  await connectRecentlyPlayed(token)
                  setSyncing(false)
                }}
              >
                {syncing ? t('lobby_syncing') : t('lobby_recently_played')}
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                disabled={!spotifyToken || syncing}
                onClick={async () => {
                  setSyncing(true)
                  const token = await ensureFreshToken()
                  if (!token) { toast.error(t('error_spotify_session_expired')); setSyncing(false); return }
                  await connectLikedSongs(token)
                  setSyncing(false)
                }}
              >
                {syncing ? t('lobby_syncing') : t('lobby_liked_songs')}
              </Button>
            </div>
          )}
        </div>

        {/* Round count + Start game — host only */}
        {isHost && (
          <div className="animate-slide-up space-y-2" style={{ animationDelay: '280ms' }}>
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                {t('lobby_rounds')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ROUND_OPTIONS.map(n => (
                  <button
                    key={n}
                    onClick={() => setRoundCount(n)}
                    className={`min-w-[36px] sm:min-w-[40px] rounded-lg px-2 sm:px-2.5 py-1.5 text-xs font-semibold transition-all active:scale-95 ${
                      roundCount === n
                        ? 'bg-brand-green text-black'
                        : 'bg-surface-2 text-muted hover:text-white'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <Button
              variant="primary"
              className="w-full"
              onClick={() => startGame(roundCount)}
              disabled={!canStart || loading || preparing}
              title={!canStart ? startDisabledReason : ''}
            >
              {(loading || preparing) ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-black border-t-transparent" />
                  {preparing ? t('preparing_tracks') : t('lobby_building')}
                </>
              ) : (
                t('lobby_start_game', { count: roundCount })
              )}
            </Button>
          </div>
        )}

        {!isHost && (
          <p className="text-center text-sm text-muted">
            {t('lobby_waiting_host')}
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-900/30 px-4 py-3">
            <p className="flex-1 text-sm text-red-400">{error}</p>
            <button onClick={clearError} className="shrink-0 text-xs text-muted hover:text-white">✕</button>
          </div>
        )}
      </div>

      {pickerToken && (
        <PlaylistPicker
          accessToken={pickerToken}
          onSelect={handleSelectPlaylist}
          onClose={() => setPickerToken(null)}
        />
      )}
    </div>
  )
}

// ─── Playing phase ────────────────────────────────────────────────────────────

function GameView({ room, currentUser, isHost, onLeave }) {
  const { submitGuess, revealRound, advanceRound } = useGameStore()

  const rounds      = Array.isArray(room.rounds) ? room.rounds : []
  const roundIndex  = room.currentRound ?? 0
  const round       = rounds[roundIndex]
  const isLastRound = roundIndex >= rounds.length - 1

  if (!round || rounds.length === 0) return <Spinner />

  return (
    <div className="flex h-full flex-col overflow-hidden px-4 sm:px-5 pt-3 pb-3">
      <div className="mx-auto w-full max-w-md space-y-2">

        {/* Round header */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-muted">
              {t('game_round', { current: roundIndex + 1, total: rounds.length })}
            </p>
            <h1 className="text-sm sm:text-base font-bold">{t('game_whose_song')}</h1>
          </div>
          <button
            onClick={onLeave}
            className="flex shrink-0 min-h-9 items-center rounded-full border border-surface-2 px-2.5 py-1 text-[10px] text-muted transition-colors hover:text-white active:scale-95"
          >
            {t('lobby_leave')}
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1.5">
          {rounds.map((_, idx) => (
            <div
              key={idx}
              className={`h-1 flex-1 rounded-full transition-colors ${
                idx < roundIndex  ? 'bg-brand-green'
                : idx === roundIndex ? 'bg-brand-green/60'
                : 'bg-surface-2'
              }`}
            />
          ))}
        </div>

        {/* Live scoreboard */}
        <div className={`rounded-xl border border-white/8 bg-white/4 px-2 py-1.5 ${
          room.players.length >= 4 ? 'grid grid-cols-2 gap-1' : 'space-y-1'
        }`}>
          {[...room.players]
            .map(p => ({ ...p, score: room.scores?.[p.uid] ?? 0 }))
            .sort((a, b) => b.score - a.score)
            .map((p, idx) => {
              const isMe   = p.uid === currentUser.uid
              const isFirst = idx === 0 && p.score > 0
              return (
                <div
                  key={p.uid}
                  className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors ${
                    isFirst
                      ? 'bg-brand-green/10 border border-brand-green/25'
                      : isMe
                        ? 'bg-white/5'
                        : ''
                  }`}
                >
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    isFirst
                      ? 'bg-brand-green/25 text-brand-green ring-1 ring-brand-green/40'
                      : 'bg-surface-2 text-white/60'
                  }`}>
                    {isFirst ? <Crown size={10} /> : p.displayName?.[0]?.toUpperCase()}
                  </span>
                  <span className={`min-w-0 flex-1 truncate text-[11px] font-medium ${isMe ? 'text-white' : 'text-white/70'}`}>
                    {p.displayName}
                  </span>
                  <span className="shrink-0 text-[11px] font-bold tabular-nums text-brand-green">
                    {p.score}
                  </span>
                </div>
              )
            })}
        </div>

        <GuessingCard
          round={round}
          players={room.players}
          currentUserId={currentUser.uid}
          isHost={isHost}
          roundIndex={roundIndex}
          isLastRound={isLastRound}
          onGuess={submitGuess}
          onReveal={revealRound}
          onAdvance={advanceRound}
        />
      </div>
    </div>
  )
}

// ─── Finished phase ───────────────────────────────────────────────────────────

function FinishedView({ room, isHost }) {
  const navigate = useNavigate()
  const adShown = useRef(false)
  const goldAwarded = useRef(false)
  const { firebaseUser } = useAuthStore()
  const addGold = useEnergyStore(s => s.addGold)
  const energy = useEnergyStore(s => s.energy)
  const [resetting, setResetting] = useState(false)

  const lowEnergy = energy < ENERGY_PER_GAME

  useEffect(() => {
    if (!adShown.current) {
      adShown.current = true
      try { showInterstitial().catch(err => console.error('[Ad]', err)) }
      catch (err) { console.error('[Ad]', err) }
    }
  }, [])

  useEffect(() => {
    if (goldAwarded.current || !firebaseUser || !room?.id) return
    if (room.goldAwarded) { goldAwarded.current = true; return }

    const scores = room.scores ?? {}
    const sortedUids = Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .map(([uid]) => uid)
    if (sortedUids[0] === firebaseUser.uid) {
      goldAwarded.current = true
      markGoldAwarded(room.id).then(async (claimed) => {
        if (!claimed) return
        await addGold(firebaseUser.uid, GOLD_PER_WIN)
        toast.success(t('gold_win_toast', { amount: GOLD_PER_WIN }))
      })
    }
  }, [room?.scores, room?.goldAwarded, firebaseUser, addGold, room?.id])

  const handleBackToLobby = async () => {
    setResetting(true)
    try {
      await resetToLobby(room.id)
    } catch (err) {
      console.error('[resetToLobby]', err)
      toast.error(t('error_generic'))
      setResetting(false)
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 sm:px-5 pt-6 pb-6">
      <div className="mx-auto w-full max-w-md space-y-4">
        <ScoreBoard
          players={room.players}
          scores={room.scores ?? {}}
          rounds={room.rounds ?? []}
          hideLeaveButton
        />

        {isHost && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={handleBackToLobby}
            disabled={resetting}
          >
            {resetting ? t('lobby_building') : t('back_to_lobby')}
          </Button>
        )}

        {!isHost && (
          <p className="text-center text-sm text-muted">{t('waiting_host_lobby')}</p>
        )}

        {lowEnergy && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-center space-y-2">
            <p className="text-sm text-amber-300">⚡ {t('energy_depleted_warning')}</p>
            <button
              onClick={() => navigate('/dashboard?shop=1')}
              className="rounded-lg bg-amber-500/20 px-4 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/30"
            >
              {t('go_to_shop')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Room root — toast watchers ────────────────────────────────────────────────

export default function Room() {
  const { roomId } = useParams()
  const navigate   = useNavigate()

  const { firebaseUser }                               = useAuthStore()
  const { room, loading, error, _subscribe, leaveRoom } = useGameStore()

  // ── Firestore subscription ────────────────────────────────────────────────
  useEffect(() => {
    _subscribe(roomId)
    return () => leaveRoom()
  }, [roomId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cleanup on tab/browser close ───────────────────────────────────────
  // beforeunload handlers are synchronous — we can't await async ops.
  // Fire the Firestore write and move on; best-effort.
  // Reliable cleanup for abandoned rooms should rely on TTL-based server cleanup.
  useEffect(() => {
    const handleBeforeUnload = () => {
      const { room: currentRoom } = useGameStore.getState()
      const { firebaseUser: currentUser } = useAuthStore.getState()
      if (currentRoom?.id && currentUser?.uid) {
        // Fire-and-forget — browser may kill the page before this completes
        fsLeaveRoom(currentRoom.id, currentUser.uid)
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  // ── Toast: new player joined (triggered by other clients' actions) ────────
  const prevPlayerCount = useRef(null)
  useEffect(() => {
    if (!room) return
    const count = room.players.length
    if (prevPlayerCount.current !== null && count > prevPlayerCount.current) {
      const newest = room.players[count - 1]
      toast(t('player_joined', { name: newest.displayName }))
    }
    prevPlayerCount.current = count
  }, [room?.players?.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toast: another player connected their playlist ────────────────────────
  const prevPlaylistCount = useRef(null)
  const connectedCount    = Object.keys(room?.playerPlaylists ?? {}).length
  useEffect(() => {
    if (!room) return
    // Skip toast for the local user's own action (they get a named toast in LobbyView)
    if (prevPlaylistCount.current !== null && connectedCount > prevPlaylistCount.current) {
      const uids   = Object.keys(room.playerPlaylists ?? {})
      const newest = room.players.find(p => uids[uids.length - 1] === p.uid)
      if (newest?.uid !== firebaseUser?.uid) {
        toast(t('playlist_connected', { name: newest?.displayName ?? 'Someone' }))
      }
    }
    prevPlaylistCount.current = connectedCount
  }, [connectedCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toast: game started ───────────────────────────────────────────────────
  const prevPhase = useRef(null)
  useEffect(() => {
    if (!room) return
    if (prevPhase.current === 'lobby' && room.phase === 'playing') {
      toast.success(t('game_started'), { duration: 4000 })
    }
    prevPhase.current = room.phase
  }, [room?.phase]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLeave = () => { leaveRoom(); navigate('/dashboard') }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (loading && !room) return <Spinner />

  if (error && !room) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
        <p className="text-red-400">{error}</p>
        <Button variant="secondary" onClick={() => navigate('/dashboard')}>
          Back to dashboard
        </Button>
      </div>
    )
  }

  if (!room) return <Spinner />

  const isHost      = room.hostId === firebaseUser?.uid
  const currentUser = firebaseUser

  // ── Phase routing ─────────────────────────────────────────────────────────
  const phaseView = () => {
    switch (room.phase) {
      case 'playing':  return <GameView    room={room} currentUser={currentUser} isHost={isHost} onLeave={handleLeave} />
      case 'finished': return <FinishedView room={room} isHost={isHost} />
      default:         return <LobbyView   room={room} currentUser={currentUser} isHost={isHost} onLeave={handleLeave} />
    }
  }

  return phaseView()
}
