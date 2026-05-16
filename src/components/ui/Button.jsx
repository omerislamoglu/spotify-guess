/**
 * Button primitive.
 * variant: 'primary' (green) | 'secondary' (surface) | 'ghost' (transparent)
 * min-h-12 (48px) ensures iOS-compliant touch targets across the whole app.
 */
export default function Button({
  children,
  variant = 'primary',
  className = '',
  disabled = false,
  ...props
}) {
  const base = 'inline-flex items-center justify-center gap-2 min-h-12 rounded-full px-6 py-3 text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green focus-visible:ring-offset-2 focus-visible:ring-offset-brand-black disabled:opacity-50 disabled:cursor-not-allowed'

  const variants = {
    primary:   'bg-brand-green text-black hover:brightness-110 active:scale-95',
    secondary: 'bg-surface-2 text-white hover:bg-surface hover:text-brand-green active:scale-95',
    ghost:     'bg-transparent text-muted hover:text-white active:scale-95',
  }

  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
