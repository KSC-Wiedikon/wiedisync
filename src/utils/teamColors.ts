/**
 * Team color scheme — systematic hierarchy:
 *   Sport → Gender → Age → Team (darker = higher rank / older)
 *
 * Volleyball Men:   Blue family    (#1e40af → #93c5fd)
 * Volleyball Women: Rose family    (#be123c → #fda4af)
 * Basketball Men:   Orange family  (#9a3412 → #fb923c)
 * Basketball Women: Purple family  (#7e22ce → #d8b4fe)
 * Basketball Mixed: Teal family    (#0d9488)
 * Sub-brands:       Lions=Violet, Rhinos=Emerald
 */
export const teamColors: Record<string, { bg: string; text: string; border: string }> = {
  // ── Volleyball Men (Blue) ─────────────────────
  H1:      { bg: '#1e40af', text: '#ffffff', border: '#1e3a8a' },  // blue-800
  H2:      { bg: '#2563eb', text: '#ffffff', border: '#1d4ed8' },  // blue-600
  H3:      { bg: '#3b82f6', text: '#ffffff', border: '#2563eb' },  // blue-500
  HU23:    { bg: '#60a5fa', text: '#1e3a8a', border: '#3b82f6' },  // blue-400 (youth)
  HU20:    { bg: '#93c5fd', text: '#1e3a8a', border: '#60a5fa' },  // blue-300 (youngest)
  Legends: { bg: '#1e3a5f', text: '#ffffff', border: '#162d4d' },  // slate-blue (veterans)

  // ── Volleyball Women (Rose) ───────────────────
  D1:      { bg: '#be123c', text: '#ffffff', border: '#9f1239' },  // rose-700
  D2:      { bg: '#e11d48', text: '#ffffff', border: '#be123c' },  // rose-600
  D3:      { bg: '#f43f5e', text: '#881337', border: '#e11d48' },  // rose-500
  D4:      { bg: '#fb7185', text: '#881337', border: '#f43f5e' },  // rose-400
  DU23:    { bg: '#fda4af', text: '#881337', border: '#fb7185' },  // rose-300 (youth)

  // ── Basketball Men (Orange) ───────────────────
  'BB-H1':   { bg: '#9a3412', text: '#ffffff', border: '#7c2d12' },  // orange-800
  'BB-H3':   { bg: '#c2410c', text: '#ffffff', border: '#9a3412' },  // orange-700
  'BB-H4':   { bg: '#ea580c', text: '#ffffff', border: '#c2410c' },  // orange-600
  'BB-HU18': { bg: '#f97316', text: '#ffffff', border: '#ea580c' },  // orange-500
  'BB-HU16': { bg: '#fb923c', text: '#7c2d12', border: '#f97316' },  // orange-400 (youth)
  'BB-HU14': { bg: '#fdba74', text: '#7c2d12', border: '#fb923c' },  // orange-300 (younger)
  'BB-HU12': { bg: '#fed7aa', text: '#7c2d12', border: '#fdba74' },  // orange-200 (youngest)
  'BB-H-Classics': { bg: '#78350f', text: '#ffffff', border: '#451a03' },  // amber-900 (veterans)

  // ── Basketball Women (Purple) ─────────────────
  'BB-D1':   { bg: '#7e22ce', text: '#ffffff', border: '#6b21a8' },  // purple-700
  'BB-D3':   { bg: '#a855f7', text: '#ffffff', border: '#9333ea' },  // purple-500
  'BB-DU18': { bg: '#c084fc', text: '#581c87', border: '#a855f7' },  // purple-400
  'BB-DU16': { bg: '#d8b4fe', text: '#581c87', border: '#c084fc' },  // purple-300
  'BB-DU14': { bg: '#e9d5ff', text: '#581c87', border: '#d8b4fe' },  // purple-200
  'BB-DU12': { bg: '#f3e8ff', text: '#581c87', border: '#e9d5ff' },  // purple-100
  'BB-DU10': { bg: '#faf5ff', text: '#581c87', border: '#f3e8ff' },  // purple-50
  'BB-D-Classics': { bg: '#581c87', text: '#ffffff', border: '#3b0764' },  // purple-900 (veterans)

  // ── Basketball Mixed (Teal) ───────────────────
  'BB-MU10': { bg: '#14b8a6', text: '#042f2e', border: '#0d9488' },  // teal-500
  'BB-MU8':  { bg: '#0d9488', text: '#ffffff', border: '#0f766e' },  // teal-600

  // ── Sub-brands ────────────────────────────────
  'BB-Lions D1':  { bg: '#6d28d9', text: '#ffffff', border: '#5b21b6' },  // violet-700
  'BB-Lions D3':  { bg: '#8b5cf6', text: '#ffffff', border: '#7c3aed' },  // violet-500
  'BB-Rhinos D1': { bg: '#059669', text: '#ffffff', border: '#047857' },  // emerald-600
  'BB-Rhinos D3': { bg: '#34d399', text: '#064e3b', border: '#10b981' },  // emerald-400

  // ── Fallback ──────────────────────────────────
  Other: { bg: '#6b7280', text: '#ffffff', border: '#4b5563' },
}

/** Maps team short names to their sport. Keys without 'BB-' prefix are volleyball. */
export const teamSport: Record<string, 'volleyball' | 'basketball'> = {
  H1: 'volleyball', H2: 'volleyball', H3: 'volleyball',
  HU20: 'volleyball', HU23: 'volleyball', Legends: 'volleyball',
  D1: 'volleyball', D2: 'volleyball', D3: 'volleyball', D4: 'volleyball',
  DU23: 'volleyball',
  'BB-H1': 'basketball', 'BB-H3': 'basketball', 'BB-H4': 'basketball',
  'BB-H-Classics': 'basketball',
  'BB-D1': 'basketball', 'BB-D3': 'basketball', 'BB-D-Classics': 'basketball',
  'BB-HU18': 'basketball', 'BB-HU16': 'basketball', 'BB-HU14': 'basketball', 'BB-HU12': 'basketball',
  'BB-DU18': 'basketball', 'BB-DU16': 'basketball', 'BB-DU14': 'basketball',
  'BB-DU12': 'basketball', 'BB-DU10': 'basketball',
  'BB-MU10': 'basketball', 'BB-MU8': 'basketball',
  'BB-Lions D1': 'basketball', 'BB-Lions D3': 'basketball',
  'BB-Rhinos D1': 'basketball', 'BB-Rhinos D3': 'basketball',
}

export const teamIds: Record<string, string> = {
  // Volleyball (vb_{swiss_volley_id})
  'vb_12747': 'H3',
  'vb_1394': 'D4',
  'vb_14040': 'DU23-2',
  'vb_7563': 'HU23-1',
  'vb_1393': 'D2',
  'vb_541': 'H2',
  'vb_6023': 'Legends',
  'vb_4689': 'D3',
  'vb_2743': 'H1',
  'vb_1395': 'D1',
  'vb_2301': 'DU23-1',
  // Basketball (bb_{basketplan_id})
  'bb_1348': 'BB-H1',
  'bb_4829': 'BB-H3',
  'bb_7183': 'BB-H4',
  'bb_4934': 'BB-D-Classics',
  'bb_4935': 'BB-H-Classics',
  'bb_4445': 'BB-Lions D1',
  'bb_1077': 'BB-Rhinos D3',
  'bb_5104': 'BB-DU12',
  'bb_5441': 'BB-DU14',
  'bb_7182': 'BB-DU16',
  'bb_5697': 'BB-DU18',
  'bb_5791': 'BB-HU12',
  'bb_5790': 'BB-HU14',
  'bb_5498': 'BB-HU16',
  'bb_5789': 'BB-HU18',
  'bb_5287': 'BB-MU10',
  'bb_6724': 'BB-MU8',
}

const fallbackColor = { bg: '#6b7280', text: '#ffffff', border: '#4b5563' }

/**
 * Match a (possibly long) basketball team name against the `BB-` shortcode keys
 * in `teamColors`, returning the matched key or null. Longest shortcode wins so
 * "Lions D1"/"H-Classics" beat the bare "D1"/"H1" substrings. Shared by
 * getTeamColor + teamNameToColorKey so the two can never disagree on which color
 * a long BB name maps to (they previously used slightly different predicates).
 */
function matchBBColorKey(name: string): string | null {
  const bbKeys = Object.keys(teamColors).filter((k) => k.startsWith('BB-'))
  bbKeys.sort((a, b) => b.length - a.length)
  for (const k of bbKeys) {
    const sc = k.slice(3) // e.g. "H1", "H-Classics", "Lions D1"
    if (name === sc || name.endsWith(` ${sc}`) || name.startsWith(`${sc} `) || name.includes(` ${sc} `)) return k
  }
  return null
}

export function getTeamColor(teamName: string) {
  const key = teamName.replace(/-\d+$/, '')
  if (teamColors[key]) return teamColors[key]
  if (teamColors[`BB-${key}`]) return teamColors[`BB-${key}`]

  // Long basketball names like "Herren 1 H1", "Damen D-Classics 1LR"
  const matched = matchBBColorKey(key)
  return matched ? teamColors[matched] : fallbackColor
}

/** Trim redundant Basketplan league suffix from BB men team display names.
 *  "Herren 1 H1" → "Herren 1", "Herren 3 (Unicorns) H4" → "Herren 3 (Unicorns)",
 *  "Damen D-Classics 1LR" → "Damen D-Classics", "H-Classics 1LR" → "H-Classics".
 *  Short names like "DU12", "Lions D1" are returned unchanged. */
export function trimBBTeamName(name: string): string {
  // Remove "BB-" prefix (sport already indicated by basketball icon)
  // Remove trailing league codes like "H1", "H3", "H4", "1LR", "1LRA"
  return name.replace(/^BB-/, '').replace(/\s+(?:H\d+|\dLR[A-Z]?)$/, '')
}

/**
 * Map a team name to a teamColors key.
 * VB teams: name matches directly (e.g. "H1" → "H1")
 * BB teams: need "BB-" prefix (e.g. "DU12" → "BB-DU12", "Lions D1" → "BB-Lions D1")
 * BB teams with long names: extract short code (e.g. "Herren 1 H1" → "BB-H1")
 */
export function teamNameToColorKey(name: string, sport: 'volleyball' | 'basketball'): string {
  if (sport === 'volleyball') return name

  // Check if "BB-{name}" exists directly in teamColors
  const direct = `BB-${name}`
  if (teamColors[direct]) return direct

  // Long basketball names like "Herren 1 H1", "Herren 3 (Unicorns) H4", "Damen D-Classics 1LR"
  return matchBBColorKey(name) ?? direct // fallback
}
