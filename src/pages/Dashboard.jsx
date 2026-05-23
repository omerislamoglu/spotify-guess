import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { PlusCircle, Users, LogOut, Crown, X, ShieldCheck, Gem, ShoppingBag, RotateCcw, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { t } from '../i18n'
import useAuthStore from '../store/useAuthStore'
import useGameStore from '../store/useGameStore'
import usePremiumStore from '../store/usePremiumStore'
import useEnergy from '../hooks/useEnergy'
import { PREMIUM_PRODUCT_MAP } from '../services/purchaseService'

// Update these with your real URLs before App Store submission
const PRIVACY_URL = import.meta.env.VITE_PRIVACY_URL ?? '#'
const TERMS_URL   = import.meta.env.VITE_TERMS_URL   ?? '#'
import Button from '../components/ui/Button'
import Card from '../components/ui/Card'
import EnergyBar from '../components/ui/EnergyBar'
import DiamondCounter from '../components/ui/DiamondCounter'
import GoldCounter from '../components/ui/GoldCounter'
import ShopModal from '../components/shop/ShopModal'

function SpotifyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  )
}

// ─── Static plan definitions (always shown) ──────────────────────────────────

const PLANS = [
  {
    id:            'weekly',
    titleKey:      'premium_plan_weekly',
    diamonds:      100,
    fallbackPrice: '₺34.99',
    badgeKey:      null,
    highlight:     false,
  },
  {
    id:            'monthly',
    titleKey:      'premium_plan_monthly',
    diamonds:      500,
    fallbackPrice: '₺99.99',
    badgeKey:      'premium_popular',
    highlight:     true,
  },
  {
    id:            'yearly',
    titleKey:      'premium_plan_yearly',
    diamonds:      5000,
    fallbackPrice: '₺699.99',
    badgeKey:      'premium_best_value',
    highlight:     false,
  },
]

// ─── Premium Modal ───────────────────────────────────────────────────────────

function PremiumModal({ onClose }) {
  const { isPremium, loading, activating, premiumPackages, loadOfferings, purchase, restore, init } = usePremiumStore()
  const [restoring, setRestoring] = useState(false)
  const offeringsLoaded = useRef(false)
  const isWeb = Capacitor.getPlatform() === 'web'

  useEffect(() => {
    if (!offeringsLoaded.current) {
      offeringsLoaded.current = true
      loadOfferings()
    }
  }, [loadOfferings])

  // For display only — uses current React state to show RC price string
  const rcPackageFor = (planId) =>
    premiumPackages.find(pkg => PREMIUM_PRODUCT_MAP[pkg.product?.identifier] === planId) ?? null

  /**
   * Trigger a purchase for a plan tier.
   * Always reads fresh store state so it works even if offerings load after render.
   * If no RC package found, retries once by reloading offerings — only then errors.
   */
  const handlePurchase = async (planId) => {
    try {
      // Returns the RC package matching this plan's product ID, or any premium
      // package as a fallback (handles mismatched product IDs during setup).
      const findPkg = () => {
        const pkgs = usePremiumStore.getState().premiumPackages
        return (
          pkgs.find(pkg => PREMIUM_PRODUCT_MAP[pkg.product?.identifier] === planId)
          ?? pkgs[0]
          ?? null
        )
      }

      let rcPkg = findPkg()

      // Offerings not loaded yet — fetch once before giving up
      if (!rcPkg) {
        await loadOfferings()
        rcPkg = findPkg()
      }

      if (!rcPkg) {
        toast.error(t('shop_store_unavailable'))
        return
      }

      const result = await purchase(rcPkg)
      if (result?.granted) {
        toast.success(t('premium_activating'))
      }
    } catch (err) {
      if (err.type === 'cancelled') return
      if (err.type === 'network')      toast.error(t('error_purchase_network'))
      else if (err.type === 'store_error')  toast.error(t('error_purchase_store'))
      else if (err.type === 'not_allowed')  toast.error(t('error_purchase_not_allowed'))
      else                                  toast.error(t('premium_purchase_failed'))
    }
  }

  const handleRestore = async () => {
    setRestoring(true)
    try {
      const uid = useAuthStore.getState().firebaseUser?.uid
      if (uid) await init(uid)
      offeringsLoaded.current = false
      loadOfferings()
      const result = await restore()
      if (result?.granted) {
        toast.success(t('premium_restored'))
        onClose()
      } else {
        toast.error(t('premium_no_purchase'))
      }
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-t-3xl bg-[#0e0e0e] max-h-[92vh] overflow-y-auto hide-scrollbar">

        {/* Drag handle */}
        <div className="sheet-handle mt-3 sm:hidden" />

        {/* ── Hero ──────────────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden px-6 pb-6 pt-5 text-center">
          {/* Ambient glow */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-500/10 via-transparent to-transparent" />

          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white/60 transition-colors hover:bg-white/15 hover:text-white active:scale-90"
          >
            <X size={15} />
          </button>

          {/* Crown icon */}
          <div className="relative mx-auto mb-4 flex h-20 w-20 items-center justify-center">
            <div className="absolute inset-0 rounded-3xl bg-amber-500/20 blur-xl" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-2xl shadow-amber-500/40">
              <Crown size={34} className="text-black" />
            </div>
          </div>

          {isPremium ? (
            <>
              <h2 className="text-2xl font-bold text-white">{t('premium_active_title')}</h2>
              <p className="mt-1 text-sm text-amber-300/70">{t('premium_active_subtitle')}</p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-white">{t('premium_title')}</h2>
              <p className="mt-1 text-sm text-white/50">{t('premium_subtitle')}</p>
            </>
          )}

          {/* Benefit chips */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {[
              { icon: ShieldCheck, key: 'premium_ad_free' },
              { icon: Gem,         key: 'premium_diamonds' },
              { icon: Crown,       key: 'premium_badge' },
            ].map(({ icon: Icon, key }) => (
              <span
                key={key}
                className="flex items-center gap-1.5 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300"
              >
                <Icon size={11} />
                {t(key)}
              </span>
            ))}
          </div>
        </div>

        {/* ── Plans ─────────────────────────────────────────────────────────── */}
        {isWeb ? (
          <div className="mx-5 mb-2 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-center text-sm text-amber-300/70">
            {t('premium_mobile_only')}
          </div>
        ) : (
          <div className="space-y-2.5 px-5 pb-2">
            {PLANS.map((plan) => {
              const rcPkg       = rcPackageFor(plan.id)
              const priceLabel  = rcPkg?.product?.priceString ?? plan.fallbackPrice
              const isHighlight = plan.highlight

              return (
                <button
                  key={plan.id}
                  onClick={() => handlePurchase(plan.id)}
                  disabled={loading}
                  className={`group relative w-full rounded-2xl border p-4 text-left transition-all active:scale-[0.98] disabled:opacity-50 ${
                    isHighlight
                      ? 'border-amber-400/50 bg-gradient-to-br from-amber-500/20 to-amber-700/10 shadow-lg shadow-amber-500/10 hover:border-amber-400/70'
                      : 'border-white/8 bg-white/4 hover:border-white/15 hover:bg-white/6'
                  }`}
                >
                  {plan.badgeKey && (
                    <span className={`absolute -top-2.5 left-4 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wide ${
                      isHighlight ? 'bg-amber-400 text-black' : 'bg-white/15 text-white/70'
                    }`}>
                      {t(plan.badgeKey)}
                    </span>
                  )}

                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                        isHighlight ? 'bg-amber-400/20' : 'bg-white/8'
                      }`}>
                        <Gem size={20} className={isHighlight ? 'text-amber-400' : 'text-white/50'} />
                      </div>
                      <div>
                        <p className={`text-sm font-bold ${isHighlight ? 'text-amber-300' : 'text-white'}`}>
                          {t(plan.titleKey)}
                        </p>
                        <p className="mt-0.5 text-xs text-white/40">
                          +{plan.diamonds.toLocaleString()} {t('shop_diamonds').toLowerCase()}
                        </p>
                      </div>
                    </div>

                    <div className={`shrink-0 rounded-xl px-3.5 py-2 text-sm font-bold ${
                      isHighlight
                        ? 'bg-amber-400/20 text-amber-300'
                        : 'bg-white/8 text-white/70'
                    }`}>
                      {priceLabel}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {activating && (
          <div className="mx-5 mt-3 flex items-center justify-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-300/70">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-amber-400/30 border-t-amber-400" />
            {t('premium_activating')}
          </div>
        )}

        {/* ── Active state benefits list ─────────────────────────────────────── */}
        {isPremium && (
          <div className="mx-5 mt-3 space-y-2">
            {[
              { icon: ShieldCheck, titleKey: 'premium_ad_free',  descKey: 'premium_ad_free_desc' },
              { icon: Gem,         titleKey: 'premium_diamonds', descKey: 'premium_diamonds_desc' },
              { icon: Crown,       titleKey: 'premium_badge',    descKey: 'premium_badge_desc' },
            ].map(({ icon: Icon, titleKey, descKey }) => (
              <div key={titleKey} className="flex items-center gap-3 rounded-2xl border border-amber-400/15 bg-amber-400/8 px-4 py-3">
                <Icon size={15} className="shrink-0 text-amber-400" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">{t(titleKey)}</p>
                  <p className="text-[11px] text-white/40">{t(descKey)}</p>
                </div>
                <span className="ml-auto shrink-0 text-[10px] font-bold text-amber-400">{t('premium_active')}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────────────────────── */}
        <div className="space-y-3 px-5 pb-8 pt-4">
          {!isPremium && (
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/60 transition-all hover:border-white/20 hover:text-white active:scale-[0.98] disabled:opacity-50"
            >
              {restoring
                ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white/80" />
                : <RotateCcw size={14} />
              }
              {t('premium_restore')}
            </button>
          )}

          <div className="flex items-center justify-center gap-4">
            <a
              href={PRIVACY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-white/30 underline-offset-2 hover:text-white/60 hover:underline"
            >
              {t('privacy_policy')}
            </a>
            <span className="text-white/15">·</span>
            <a
              href={TERMS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-white/30 underline-offset-2 hover:text-white/60 hover:underline"
            >
              {t('terms_of_service')}
            </a>
          </div>

          <p className="text-center text-[10px] text-white/25">
            {t('premium_payment')}
          </p>
        </div>

      </div>
    </div>
  )
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const navigate                    = useNavigate()
  const [searchParams]              = useSearchParams()
  const [joinCode, setJoinCode]     = useState('')
  const [view, setView]             = useState('home') // 'home' | 'join'
  const [showPremium, setShowPremium] = useState(false)
  const [showShop, setShowShop]       = useState(() => searchParams.get('shop') === '1')

  const { firebaseUser, spotifyProfile, signOut } = useAuthStore()
  const { createRoom, joinRoom, loading, error, clearError } = useGameStore()
  const isPremium = usePremiumStore(s => s.isPremium)
  const { canPlay, costPerGame, consumeEnergy, addEnergy } = useEnergy()

  const displayName = spotifyProfile?.displayName ?? firebaseUser?.displayName ?? 'there'

  const player = {
    uid:         firebaseUser?.uid,
    displayName: displayName,
    avatarUrl:   spotifyProfile?.photoURL ?? firebaseUser?.photoURL ?? null,
    isPremium,
  }

  const handleCreate = async () => {
    const roomId = await createRoom(player)
    if (roomId) {
      navigate(`/room/${roomId}`)
    } else {
      toast.error(t('dash_room_failed_refund'))
    }
  }

  const handleJoin = async (e) => {
    e.preventDefault()
    if (!joinCode.trim()) return
    if (!canPlay) {
      toast.error(t('dash_no_energy_join', { cost: costPerGame }))
      return
    }
    const allowed = await consumeEnergy()
    if (!allowed) {
      toast.error(t('dash_no_energy_join', { cost: costPerGame }))
      return
    }
    const roomId = await joinRoom(joinCode.trim(), player)
    if (roomId) {
      navigate(`/room/${roomId}`)
    } else {
      // Join failed — refund the consumed energy
      await addEnergy(costPerGame)
      toast.error(t('dash_room_failed_refund'))
    }
  }

  const handleSignOut = async () => {
    await signOut()
    toast(t('dash_signed_out'))
  }

  return (
    <div className="flex min-h-full flex-col px-4 sm:px-5 pt-6 pb-6">
      <div className="mx-auto w-full max-w-md space-y-5">

        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h1 className={`text-xl sm:text-2xl font-bold truncate ${
                isPremium
                  ? 'bg-gradient-to-r from-amber-300 via-yellow-300 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(251,191,36,0.35)]'
                  : ''
              }`}>
                {t('dash_hey', { name: displayName.split(' ')[0] })}
              </h1>
              <span className="flex items-center gap-1 rounded-full bg-brand-green/20 px-2 py-0.5 text-xs text-brand-green">
                <SpotifyIcon />
                {t('dash_connected')}
              </span>
              {isPremium && (
                <span className="flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-yellow-400 px-2.5 py-0.5 text-[11px] font-bold text-black shadow-[0_0_10px_rgba(251,191,36,0.6)] shadow-amber-400/60">
                  <Crown size={9} />
                  PRO
                </span>
              )}
            </div>
            <p className="text-sm text-muted">{t('dash_ready')}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <GoldCounter onClick={() => setShowShop(true)} />
            <DiamondCounter onClick={() => setShowShop(true)} />
            <button
              onClick={handleSignOut}
              className="flex items-center justify-center h-8 w-8 rounded-full text-muted transition-colors hover:bg-surface hover:text-white active:scale-95"
              aria-label="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        </div>

        {/* Energy Bar */}
        <EnergyBar />

        {/* Actions */}
        {view === 'home' && (
          <div className="space-y-3">
            <Button
              variant="primary"
              className="w-full"
              onClick={handleCreate}
              disabled={loading}
            >
              <PlusCircle size={17} />
              {loading ? t('dash_creating') : t('dash_create_room')}
            </Button>
            {!canPlay && (
              <button
                onClick={() => setShowShop(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-900/20 border border-red-500/20 px-4 py-2.5 text-xs text-red-400 transition-all hover:bg-red-900/30 active:scale-[0.98]"
              >
                <Zap size={13} />
                {t('dash_no_energy')}
              </button>
            )}
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => { clearError(); setView('join') }}
              disabled={!canPlay}
            >
              <Users size={17} />
              {t('dash_join_code')}
            </Button>
          </div>
        )}

        {view === 'join' && (
          <Card>
            <form onSubmit={handleJoin} className="space-y-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium">{t('room_code_label')}</span>
                <input
                  type="text"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  placeholder={t('room_code_placeholder')}
                  autoComplete="off"
                  className="w-full rounded-xl bg-surface-2 px-4 py-3 text-center text-2xl font-mono tracking-widest text-white placeholder-muted outline-none focus:ring-2 focus:ring-brand-green"
                />
              </label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="flex-1"
                  onClick={() => { setView('home'); setJoinCode('') }}
                >
                  {t('room_back')}
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  className="flex-1"
                  disabled={loading || joinCode.length < 6 || !canPlay}
                >
                  {loading ? t('room_joining') : t('room_join')}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {error && (
          <p className="rounded-lg bg-red-900/30 px-4 py-3 text-center text-sm text-red-400">
            {error}
          </p>
        )}

        {/* Shop button */}
        <button
          onClick={() => setShowShop(true)}
          className="flex w-full items-center justify-between rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 to-cyan-600/5 px-5 py-4 transition-all active:scale-[0.98]"
        >
          <div className="flex items-center gap-3">
            <ShoppingBag size={18} className="text-cyan-400" />
            <div className="text-left">
              <p className="text-sm font-semibold text-cyan-400">{t('dash_shop')}</p>
              <p className="text-xs text-muted">{t('dash_shop_desc')}</p>
            </div>
          </div>
          <span className="text-xs font-medium text-muted">{t('dash_open')}</span>
        </button>

        {/* Premium upsell */}
        {!isPremium && (
          <button
            onClick={() => setShowPremium(true)}
            className="flex w-full items-center justify-between rounded-2xl border border-amber-400/30 bg-gradient-to-r from-amber-400/10 to-amber-600/10 px-5 py-4 transition-all active:scale-[0.98]"
          >
            <div className="flex items-center gap-3">
              <Crown size={18} className="text-amber-400" />
              <div className="text-left">
                <p className="text-sm font-semibold text-amber-400">{t('dash_go_premium')}</p>
                <p className="text-xs text-muted">{t('dash_premium_desc')}</p>
              </div>
            </div>
            <span className="text-xs font-medium text-muted">{t('dash_upgrade')}</span>
          </button>
        )}

      </div>

      {showShop && <ShopModal onClose={() => setShowShop(false)} />}
      {showPremium && <PremiumModal onClose={() => setShowPremium(false)} />}
    </div>
  )
}
