import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export default function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
      {icon && (typeof icon === 'string'
        ? <span className="text-4xl">{icon}</span>
        : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-[26px] [&_svg]:stroke-[1.75]">{icon}</div>)}
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground/80">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}
