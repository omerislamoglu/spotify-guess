import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import useAuthStore from '../store/useAuthStore'
import useGameStore from '../store/useGameStore'
import useEnergyStore from '../store/useEnergyStore'
import usePremiumStore from '../store/usePremiumStore'
import useEnergy from '../hooks/useEnergy'
import { t } from '../i18n'

export default function JoinRoom() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [joining, setJoining] = useState(false)

  const { firebaseUser, spotifyProfile } = useAuthStore()
  const { joinRoom } = useGameStore()
  const isPremium = usePremiumStore(s => s.isPremium)
  const { canPlay, costPerGame, consumeEnergy, addEnergy } = useEnergy()

  const displayName = spotifyProfile?.displayName ?? firebaseUser?.displayName ?? 'Player'

  const player = {
    uid:         firebaseUser.uid,
    displayName,
    avatarUrl:   spotifyProfile?.photoURL ?? firebaseUser?.photoURL ?? null,
    isPremium,
  }

  useEffect(() => {
    if (!code || joining) return

    const doJoin = async () => {
      setJoining(true)

      if (!canPlay) {
        toast.error(t('dash_no_energy_join', { cost: costPerGame }))
        navigate('/dashboard', { replace: true })
        return
      }

      const allowed = await consumeEnergy()
      if (!allowed) {
        toast.error(t('dash_no_energy_join', { cost: costPerGame }))
        navigate('/dashboard', { replace: true })
        return
      }

      const roomId = await joinRoom(code.trim().toUpperCase(), player)
      if (roomId) {
        navigate(`/room/${roomId}`, { replace: true })
      } else {
        await addEnergy(costPerGame)
        toast.error(t('join_room_not_found'))
        navigate('/dashboard', { replace: true })
      }
    }

    doJoin()
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-4">
      <span className="h-8 w-8 animate-spin rounded-full border-4 border-brand-green border-t-transparent" />
      <p className="text-sm text-muted">{t('join_joining_room', { code: code?.toUpperCase() })}</p>
    </div>
  )
}
