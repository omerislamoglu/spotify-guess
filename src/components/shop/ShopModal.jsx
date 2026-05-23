import { useState, useEffect } from 'react'
import { X, Gem, Zap, ShoppingBag, Sparkles, ArrowRightLeft, Play, Coins } from 'lucide-react'
import toast from 'react-hot-toast'
import { t } from '../../i18n'
import useEnergy from '../../hooks/useEnergy'
import useAuthStore from '../../store/useAuthStore'
import useEnergyStore from '../../store/useEnergyStore'
import usePremiumStore from '../../store/usePremiumStore'
import { DIAMOND_PACKAGES, ENERGY_PACKAGES, GOLD_PACKAGES, ENERGY_PER_GAME } from '../../services/energyService'
import { purchaseDiamonds, getDiamondPackages } from '../../services/purchaseService'
import { showRewardedAd } from '../../services/adService'

// ─── Tab Button ──────────────────────────────────────────────────────────────

function Tab({ active, icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all ${
        active
          ? 'bg-surface-2 text-white shadow-sm'
          : 'text-muted hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// ─── Diamond Package Card ────────────────────────────────────────────────────

function DiamondCard({ pkg, rcPkg, onBuy, loading }) {
  // Visual scaling — bigger packs get bigger icons
  const gemCount = pkg.diamonds >= 300 ? 3 : pkg.diamonds >= 120 ? 2 : 1
  // Use RevenueCat price string if available, otherwise fall back to local TL price
  const priceLabel = rcPkg?.product?.priceString ?? `${pkg.priceTL.toFixed(2)} TL`

  return (
    <button
      onClick={() => onBuy(pkg, rcPkg)}
      disabled={loading}
      className="relative flex w-full items-center justify-between rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 to-cyan-600/5 px-5 py-4 transition-all hover:border-cyan-500/40 active:scale-[0.98] disabled:opacity-50"
    >
      {pkg.badge && (
        <span className="absolute -top-2.5 right-4 rounded-full bg-cyan-500 px-2.5 py-0.5 text-[10px] font-bold text-black">
          {pkg.badge}
        </span>
      )}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/30 to-cyan-600/10">
          <div className="flex items-center">
            {Array.from({ length: gemCount }, (_, i) => (
              <Gem
                key={i}
                size={gemCount > 1 ? 14 : 18}
                className="text-cyan-400"
                style={gemCount > 1 ? { marginLeft: i > 0 ? -4 : 0 } : {}}
              />
            ))}
          </div>
        </div>
        <div className="text-left">
          <p className="text-sm font-bold text-white">{pkg.label}</p>
          <p className="text-xs text-muted">
            {pkg.diamonds} {t('shop_diamonds').toLowerCase()}
          </p>
        </div>
      </div>
      <span className="rounded-xl bg-cyan-500/20 px-3 py-1.5 text-sm font-bold text-cyan-400">
        {priceLabel}
      </span>
    </button>
  )
}

// ─── Energy Exchange Card ────────────────────────────────────────────────────

function EnergyCard({ pkg, diamonds, onBuy, loading }) {
  const canAfford = diamonds >= pkg.diamondCost
  const isBig     = pkg.energyGain > 10

  return (
    <button
      onClick={() => onBuy(pkg)}
      disabled={loading || !canAfford}
      className={`relative flex w-full items-center justify-between rounded-2xl border px-5 py-4 transition-all active:scale-[0.98] disabled:opacity-50 ${
        canAfford
          ? 'border-brand-green/20 bg-gradient-to-r from-brand-green/10 to-brand-green/5 hover:border-brand-green/40'
          : 'border-surface-2 bg-surface-2/50 cursor-not-allowed'
      }`}
    >
      {isBig && canAfford && (
        <span className="absolute -top-2.5 right-4 rounded-full bg-brand-green px-2.5 py-0.5 text-[10px] font-bold text-black">
          Overflow
        </span>
      )}
      <div className="flex items-center gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          canAfford
            ? 'bg-gradient-to-br from-brand-green/30 to-brand-green/10'
            : 'bg-surface-2'
        }`}>
          <Zap size={18} className={canAfford ? 'text-brand-green' : 'text-muted'} />
        </div>
        <div className="text-left">
          <p className="text-sm font-bold text-white">{pkg.label}</p>
          <p className="text-xs text-muted">
            {isBig ? t('shop_overflow') : t('shop_refills')}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 rounded-xl bg-cyan-500/20 px-3 py-1.5">
        <Gem size={12} className="text-cyan-400" />
        <span className="text-sm font-bold text-cyan-400">{pkg.diamondCost}</span>
      </div>
    </button>
  )
}

// ─── Shop Modal ──────────────────────────────────────────────────────────────

export default function ShopModal({ onClose }) {
  const [tab, setTab] = useState('diamonds') // 'diamonds' | 'energy' | 'gold'
  const [adLoading, setAdLoading] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const { diamonds, gold, energy, maxEnergy, loading, isPremium, addEnergy, buyEnergyWithDiamonds, buyDiamondsWithGold, refillEnergy } = useEnergy()

  // Fetch RevenueCat offerings for diamond prices
  const offerings = usePremiumStore(s => s.offerings)
  const loadOfferings = usePremiumStore(s => s.loadOfferings)
  const rcDiamondPkgs = getDiamondPackages(offerings)

  useEffect(() => {
    if (!offerings) loadOfferings()
  }, [offerings, loadOfferings])

  // Map RevenueCat packages to our local DIAMOND_PACKAGES by product identifier
  const rcPkgMap = {}
  for (const rc of rcDiamondPkgs) {
    const prodId = rc.product?.identifier ?? ''
    // e.g. "echoguess_diamonds_50" → "diamonds_50"
    const localId = prodId.replace('echoguess_', '')
    rcPkgMap[localId] = rc
  }

  const handleBuyDiamonds = async (localPkg, rcPkg) => {
    if (!rcPkg) {
      toast.error(t('shop_store_unavailable'))
      return
    }
    setPurchasing(true)
    try {
      const { purchased, diamonds: diamondCount } = await purchaseDiamonds(rcPkg)
      if (purchased && diamondCount > 0) {
        // Diamonds are credited server-side via RevenueCat webhook.
        // Re-fetch balances so the UI updates once the webhook processes.
        toast.success(t('shop_diamonds_purchased', { count: diamondCount }))
        const uid = useAuthStore.getState().firebaseUser?.uid
        if (uid) useEnergyStore.getState().loadEnergy(uid)
      } else if (!purchased) {
        // User cancelled — no toast needed
      }
    } catch {
      toast.error(t('shop_purchase_failed'))
    } finally {
      setPurchasing(false)
    }
  }

  const handleBuyEnergy = async (pkg) => {
    try {
      const { energy: newEnergy } = await buyEnergyWithDiamonds(pkg.id)
      toast.success(t('shop_energy_purchased', { gain: pkg.energyGain, total: newEnergy }))
    } catch (err) {
      const msg = err.message ?? ''
      if (msg.includes('insufficient_diamonds') || msg === 'NOT_ENOUGH_DIAMONDS') {
        toast.error(t('shop_not_enough_diamonds'))
      } else {
        toast.error(t('shop_exchange_failed'))
      }
    }
  }

  const handleWatchAd = async () => {
    setAdLoading(true)
    try {
      const rewarded = await showRewardedAd()
      if (rewarded) {
        // Add energy atomically, capped at MAX_ENERGY (no overflow from ads)
        await addEnergy(ENERGY_PER_GAME, maxEnergy)
        toast.success(t('shop_energy_from_ad', { gain: ENERGY_PER_GAME }))
      } else {
        toast.error(t('shop_ad_watch_full'))
      }
    } catch {
      toast.error(t('shop_ad_unavailable'))
    } finally {
      setAdLoading(false)
    }
  }

  const handleBuyDiamondsWithGold = async (pkg) => {
    try {
      const { diamonds: newDiamonds } = await buyDiamondsWithGold(pkg.id)
      toast.success(t('shop_diamonds_from_gold', { gain: pkg.diamondGain, total: newDiamonds }))
    } catch (err) {
      const msg = err.message ?? ''
      if (msg.includes('insufficient_gold') || msg === 'NOT_ENOUGH_GOLD') {
        toast.error(t('shop_not_enough_gold'))
      } else {
        toast.error(t('shop_exchange_failed'))
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="w-full max-w-sm rounded-t-3xl sm:rounded-2xl bg-surface max-h-[85vh] overflow-y-auto hide-scrollbar">

        {/* Drag handle (mobile) */}
        <div className="sheet-handle mt-3 sm:hidden" />

        {/* Hero banner */}
        <div className="relative overflow-hidden rounded-t-3xl sm:rounded-t-2xl bg-gradient-to-br from-cyan-500/25 via-brand-green/15 to-surface px-5 sm:px-6 pb-5 pt-4 sm:pt-5">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 rounded-full bg-black/30 p-2 text-white/70 transition-colors hover:text-white active:scale-90"
          >
            <X size={16} />
          </button>

          <div className="flex flex-col items-center text-center">
            <div className="mb-2.5 flex h-14 w-14 sm:h-16 sm:w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-brand-green shadow-lg shadow-cyan-500/30">
              <ShoppingBag size={24} className="text-black sm:hidden" />
              <ShoppingBag size={28} className="text-black hidden sm:block" />
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-white">{t('shop_title')}</h2>
            <p className="mt-0.5 text-xs sm:text-sm text-cyan-200/80">{t('shop_subtitle')}</p>
          </div>
        </div>

        <div className="space-y-4 sm:space-y-5 p-4 sm:p-6">

          {/* Balances */}
          <div className="grid grid-cols-3 gap-2">
            <div className="flex items-center gap-2 rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 to-cyan-600/5 px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/20">
                <Gem size={14} className="text-cyan-400" />
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-wider text-muted">{t('shop_diamonds')}</p>
                <p className="text-sm font-bold text-cyan-400">{diamonds}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/10 to-amber-600/5 px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20">
                <Coins size={14} className="text-amber-400" />
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-wider text-muted">{t('shop_gold')}</p>
                <p className="text-sm font-bold text-amber-400">{gold}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-2xl border border-brand-green/20 bg-gradient-to-r from-brand-green/10 to-brand-green/5 px-3 py-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-green/20">
                <Zap size={14} className="text-brand-green" />
              </div>
              <div>
                <p className="text-[9px] uppercase tracking-wider text-muted">{t('shop_energy')}</p>
                <p className="text-sm font-bold text-brand-green">{energy}/{maxEnergy}</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 rounded-xl bg-surface-2/50 p-1">
            <Tab
              active={tab === 'diamonds'}
              icon={<Gem size={13} />}
              label={t('shop_tab_diamonds')}
              onClick={() => setTab('diamonds')}
            />
            <Tab
              active={tab === 'gold'}
              icon={<Coins size={13} />}
              label={t('shop_tab_gold')}
              onClick={() => setTab('gold')}
            />
            <Tab
              active={tab === 'energy'}
              icon={<Zap size={13} />}
              label={t('shop_tab_energy')}
              onClick={() => setTab('energy')}
            />
          </div>

          {/* Content */}
          <div className="space-y-3">
            {tab === 'diamonds' && (
              <>
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                  <Sparkles size={12} className="text-cyan-400" />
                  {t('shop_use_diamonds')}
                </p>
                {DIAMOND_PACKAGES.map(pkg => (
                  <DiamondCard
                    key={pkg.id}
                    pkg={pkg}
                    rcPkg={rcPkgMap[pkg.id] ?? null}
                    onBuy={handleBuyDiamonds}
                    loading={loading || purchasing}
                  />
                ))}
                <p className="text-center text-[10px] text-muted pt-1">
                  {t('shop_payment_info')}
                </p>
              </>
            )}

            {tab === 'gold' && (
              <>
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                  <Coins size={12} className="text-amber-400" />
                  {t('shop_exchange_gold')}
                </p>
                {GOLD_PACKAGES.map(pkg => {
                  const canAfford = gold >= pkg.goldCost
                  return (
                    <button
                      key={pkg.id}
                      onClick={() => handleBuyDiamondsWithGold(pkg)}
                      disabled={loading || !canAfford}
                      className={`relative flex w-full items-center justify-between rounded-2xl border px-5 py-4 transition-all active:scale-[0.98] disabled:opacity-50 ${
                        canAfford
                          ? 'border-amber-400/20 bg-gradient-to-r from-amber-400/10 to-amber-500/5 hover:border-amber-400/40'
                          : 'border-surface-2 bg-surface-2/50 cursor-not-allowed'
                      }`}
                    >
                      {pkg.badge && canAfford && (
                        <span className="absolute -top-2.5 right-4 rounded-full bg-amber-400 px-2.5 py-0.5 text-[10px] font-bold text-black">
                          {pkg.badge}
                        </span>
                      )}
                      <div className="flex items-center gap-3">
                        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
                          canAfford
                            ? 'bg-gradient-to-br from-amber-400/30 to-amber-500/10'
                            : 'bg-surface-2'
                        }`}>
                          <Gem size={18} className={canAfford ? 'text-cyan-400' : 'text-muted'} />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-bold text-white">{pkg.label}</p>
                          <p className="text-xs text-muted">
                            {t('shop_gold_per_diamond', { cost: (pkg.goldCost / pkg.diamondGain).toFixed(0) })}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-xl bg-amber-400/20 px-3 py-1.5">
                        <Coins size={12} className="text-amber-400" />
                        <span className="text-sm font-bold text-amber-400">{pkg.goldCost}</span>
                      </div>
                    </button>
                  )
                })}
                <p className="text-center text-[10px] text-muted pt-1">
                  {t('shop_win_gold')}
                </p>
              </>
            )}

            {tab === 'energy' && (
              <>
                <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
                  <ArrowRightLeft size={12} className="text-brand-green" />
                  {t('shop_exchange_diamonds')}
                </p>

                {/* Watch Ad for Energy */}
                {!isPremium && (
                  <button
                    onClick={handleWatchAd}
                    disabled={adLoading}
                    className="relative flex w-full items-center justify-between rounded-2xl border border-purple-500/20 bg-gradient-to-r from-purple-500/10 to-purple-600/5 px-5 py-4 transition-all hover:border-purple-500/40 active:scale-[0.98] disabled:opacity-50"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500/30 to-purple-600/10">
                        <Play size={18} className="text-purple-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-bold text-white">
                          {adLoading ? t('shop_loading_ad') : t('shop_watch_ad')}
                        </p>
                        <p className="text-xs text-muted">{t('shop_free_energy')}</p>
                      </div>
                    </div>
                    <span className="flex items-center gap-1.5 rounded-xl bg-brand-green/20 px-3 py-1.5">
                      <Zap size={12} className="text-brand-green" />
                      <span className="text-sm font-bold text-brand-green">+{ENERGY_PER_GAME}</span>
                    </span>
                  </button>
                )}

                {ENERGY_PACKAGES.map(pkg => (
                  <EnergyCard
                    key={pkg.id}
                    pkg={pkg}
                    diamonds={diamonds}
                    onBuy={handleBuyEnergy}
                    loading={loading}
                  />
                ))}
                <p className="text-center text-[10px] text-muted pt-1">
                  {t('shop_can_exceed')}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
