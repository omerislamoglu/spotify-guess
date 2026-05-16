import { useEffect, useState } from 'react'
import { fetchPlaylists } from '../../services/spotifyService'
import { t } from '../../i18n'
import Button from '../ui/Button'

/**
 * Bottom-sheet modal for choosing which Spotify playlist to contribute.
 *
 * Props:
 *  accessToken  — fresh Spotify token
 *  onSelect(playlist) — called with the full Spotify playlist object
 *  onClose()          — called when dismissed without selecting
 */
export default function PlaylistPicker({ accessToken, onSelect, onClose }) {
  const [playlists, setPlaylists] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState(null)

  useEffect(() => {
    fetchPlaylists(accessToken)
      .then(data => {
        const items = data.items ?? []
        setPlaylists(items)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [accessToken])

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Sheet */}
      <div className="w-full max-w-md rounded-t-2xl bg-surface pb-safe max-h-[85vh] flex flex-col">
        {/* Drag handle */}
        <div className="sheet-handle mt-3" />
        {/* Handle + header */}
        <div className="flex items-center justify-between px-5 sm:px-6 pt-3 pb-3 border-b border-surface-2">
          <h2 className="text-base font-bold">{t('picker_title')}</h2>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-muted hover:text-white transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto hide-scrollbar px-4 py-3 space-y-2">
          {loading && (
            <div className="flex justify-center py-10">
              <span className="h-7 w-7 animate-spin rounded-full border-4 border-brand-green border-t-transparent" />
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-400">{error}</p>
          )}

          {!loading && !error && playlists.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">{t('picker_no_playlists')}</p>
          )}

          {playlists.map(playlist => (
            <button
              key={playlist.id}
              onClick={() => onSelect(playlist)}
              className="w-full flex items-center gap-3 rounded-xl border border-transparent bg-surface-2 p-3 text-left transition-all hover:border-brand-green/40 hover:bg-brand-green/10 active:scale-[0.98]"
            >
              {playlist.images?.[0]?.url ? (
                <img
                  src={playlist.images[0].url}
                  alt={playlist.name}
                  className="h-12 w-12 shrink-0 rounded-lg object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface text-xl">
                  🎵
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{playlist.name}</p>
                <p className="text-xs text-muted">
                  {playlist.trackCount > 0 ? t('picker_tracks', { count: playlist.trackCount }) : t('picker_click_load')}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Fallback note + cancel */}
        <div className="shrink-0 px-4 pb-4 pt-2 space-y-2">
          <p className="text-center text-xs text-muted">
            {t('picker_itunes_note')}
          </p>
          <Button variant="ghost" className="w-full" onClick={onClose}>
            {t('picker_cancel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
