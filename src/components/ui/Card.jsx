/** Surface card container. */
export default function Card({ children, className = '' }) {
  return (
    <div className={`rounded-2xl bg-surface p-6 ${className}`}>
      {children}
    </div>
  )
}
