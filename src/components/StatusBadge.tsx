const defaultColors: Record<string, string> = {
  present: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  absent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  late: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  excused: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  injury: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  vacation: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400',
  work: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  personal: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  // Roles
  user: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  player: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  coach: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  captain: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  team_responsible: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
  vorstand: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  vb_admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  bb_admin: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  superadmin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  superuser: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  website_admin: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400',
  finance: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  // Event types
  verein: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  social: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  meeting: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  tournament: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  trainingsweekend: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  friendly: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400',
}

const labelMap: Record<string, string> = {
  present: 'Present',
  absent: 'Absent',
  late: 'Late',
  excused: 'Excused',
  injury: 'Injury',
  vacation: 'Vacation',
  work: 'Work',
  personal: 'Personal',
  other: 'Other',
  // Roles
  user: 'User',
  player: 'Player',
  coach: 'Coach',
  captain: 'Captain',
  team_responsible: 'Team Resp.',
  vorstand: 'Board',
  admin: 'Admin',
  vb_admin: 'VB Admin',
  bb_admin: 'BB Admin',
  superadmin: 'SuperAdmin',
  superuser: 'Superuser',
  website_admin: 'Website Admin',
  finance: 'Finance',
  // Event types
  verein: 'Verein',
  social: 'Social',
  meeting: 'Meeting',
  tournament: 'Tournament',
  trainingsweekend: 'Trainingsweekend',
  friendly: 'Friendly',
}

interface StatusBadgeProps {
  status: string
  /** @deprecated Use the built-in color map instead */
  colorMap?: Record<string, { bg: string; text: string }>
  className?: string
}

export default function StatusBadge({ status, colorMap, className = '' }: StatusBadgeProps) {
  // Legacy inline-style path for callers still using colorMap
  if (colorMap) {
    const colors = colorMap[status] ?? colorMap.other ?? { bg: '#f3f4f6', text: '#374151' }
    return (
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
        style={{ backgroundColor: colors.bg, color: colors.text }}
      >
        {labelMap[status] ?? status}
      </span>
    )
  }

  const colorClass = defaultColors[status] ?? defaultColors.other

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass} ${className}`}
    >
      {labelMap[status] ?? status}
    </span>
  )
}
