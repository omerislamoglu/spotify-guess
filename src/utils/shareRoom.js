import { Share } from '@capacitor/share'
import { Capacitor } from '@capacitor/core'
import { t } from '../i18n'
import toast from 'react-hot-toast'

export async function shareRoom(code) {
  const appUrl = import.meta.env.VITE_APP_URL || window.location.origin
  const url = `${appUrl}/join/${code}`
  const text = t('share_room_message', { url })

  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ text, dialogTitle: 'EchoGuess' })
    } catch (e) {
      if (e?.message !== 'Share canceled') console.error('[share]', e)
    }
    return
  }

  if (navigator.share) {
    try { await navigator.share({ text }) } catch { /* cancelled */ }
    return
  }

  await navigator.clipboard.writeText(url)
  toast.success(t('share_link_copied'))
}
