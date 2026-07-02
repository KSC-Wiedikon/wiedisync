interface ChartViewProps {
  data: Record<string, unknown>[]
  columns: string[]
}

type ChartType = 'bar' | 'line' | 'pie'

// Per-column type metadata — computed once in ChartView and passed down so the
// numeric/date scan over every column × row doesn't repeat in each subcomponent.
interface ColMeta {
  col: string
  numeric: boolean
  date: boolean
}

interface ChartProps {
  data: Record<string, unknown>[]
  colMeta: ColMeta[]
}

// Brand colors
const COLORS = ['#4A55A2', '#FFC832', '#22c55e', '#ef4444', '#f97316', '#8b5cf6', '#06b6d4']

// ─── Helpers ───────────────────────────────────────────────────────────────

function isNumeric(values: unknown[]): boolean {
  if (values.length === 0) return false
  return values.every((v) => v !== null && v !== undefined && v !== '' && !isNaN(Number(v)))
}

function isDateColumn(values: unknown[]): boolean {
  if (values.length === 0) return false
  const dateRe = /^\d{4}-\d{2}-\d{2}/
  return values.every((v) => typeof v === 'string' && dateRe.test(v))
}

function computeColMeta(data: Record<string, unknown>[], columns: string[]): ColMeta[] {
  return columns.map((col) => {
    const values = data.map((row) => row[col])
    return { col, numeric: isNumeric(values), date: isDateColumn(values) }
  })
}

function detectChartType(colMeta: ColMeta[], rowCount: number): ChartType {
  if (rowCount === 0 || colMeta.length === 0) return 'bar'

  const numericCols = colMeta.filter((c) => c.numeric)
  const dateCols = colMeta.filter((c) => c.date && !c.numeric)
  const textCols = colMeta.filter((c) => !c.numeric && !c.date)

  // Date + number → line chart
  if (dateCols.length >= 1 && numericCols.length >= 1) return 'line'

  // 1 number column only with few rows → pie chart
  if (numericCols.length === 1 && textCols.length === 0 && dateCols.length === 0 && rowCount < 10) return 'pie'

  // 1 text + 1 number → bar (or multi-series bar)
  return 'bar'
}

function toNum(v: unknown): number {
  return Number(v) || 0
}

function shortLabel(v: unknown, maxLen = 10): string {
  const s = String(v ?? '')
  return s.length > maxLen ? s.slice(0, maxLen) + '…' : s
}

// ─── Bar Chart ─────────────────────────────────────────────────────────────

function BarChart({ data, colMeta }: ChartProps) {
  const numericCols = colMeta.filter((c) => c.numeric).map((c) => c.col)
  const xCol = colMeta.find((c) => !c.numeric)?.col ?? null

  if (numericCols.length === 0) return <NoData />

  const W = 600
  const H = 300
  const padL = 48
  const padR = 16
  const padT = 20
  const padB = 60

  const chartW = W - padL - padR
  const chartH = H - padT - padB

  const n = data.length
  const groupW = chartW / n
  const barW = Math.max(4, (groupW * 0.7) / numericCols.length)
  const gap = (groupW - barW * numericCols.length) / 2

  const allVals = data.flatMap((row) => numericCols.map((c) => toNum(row[c])))
  const maxVal = Math.max(...allVals, 1)

  const yTicks = 4
  const yStep = maxVal / yTicks

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-label="Bar chart">
      {/* Y grid + labels */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const val = yStep * i
        const y = padT + chartH - (val / maxVal) * chartH
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={padL + chartW} y2={y} stroke="currentColor" strokeOpacity={0.1} />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.6}>
              {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
            </text>
          </g>
        )
      })}

      {/* Bars */}
      {data.map((row, i) => {
        const groupX = padL + i * groupW
        const xLabel = xCol ? shortLabel(row[xCol]) : String(i + 1)
        return (
          <g key={i}>
            {numericCols.map((col, si) => {
              const val = toNum(row[col])
              const barH = (val / maxVal) * chartH
              const x = groupX + gap + si * barW
              const y = padT + chartH - barH
              return (
                <rect
                  key={col}
                  x={x}
                  y={y}
                  width={barW - 1}
                  height={Math.max(barH, 1)}
                  fill={COLORS[si % COLORS.length]}
                  rx={2}
                  opacity={0.9}
                >
                  <title>{`${col}: ${val}${xCol ? ` (${row[xCol]})` : ''}`}</title>
                </rect>
              )
            })}
            {/* X-axis label */}
            <text
              x={groupX + groupW / 2}
              y={padT + chartH + 14}
              textAnchor="middle"
              fontSize={9}
              fill="currentColor"
              fillOpacity={0.7}
            >
              {xLabel}
            </text>
          </g>
        )
      })}

      {/* Axes */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="currentColor" strokeOpacity={0.3} />
      <line
        x1={padL}
        y1={padT + chartH}
        x2={padL + chartW}
        y2={padT + chartH}
        stroke="currentColor"
        strokeOpacity={0.3}
      />

      {/* Legend (multi-series only) */}
      {numericCols.length > 1 &&
        numericCols.map((col, si) => (
          <g key={col} transform={`translate(${padL + si * 110}, ${H - 14})`}>
            <rect x={0} y={-8} width={10} height={10} fill={COLORS[si % COLORS.length]} rx={2} />
            <text x={14} y={0} fontSize={9} fill="currentColor" fillOpacity={0.8}>
              {shortLabel(col, 14)}
            </text>
          </g>
        ))}
    </svg>
  )
}

// ─── Line Chart ─────────────────────────────────────────────────────────────

function LineChart({ data, colMeta }: ChartProps) {
  const xCol = colMeta.find((c) => c.date && !c.numeric)?.col ?? colMeta.find((c) => !c.numeric)?.col ?? null
  const numericCols = colMeta.filter((c) => c.numeric).map((c) => c.col)

  if (numericCols.length === 0) return <NoData />

  const W = 600
  const H = 300
  const padL = 48
  const padR = 16
  const padT = 20
  const padB = 60

  const chartW = W - padL - padR
  const chartH = H - padT - padB
  const n = data.length

  const allVals = data.flatMap((row) => numericCols.map((c) => toNum(row[c])))
  const maxVal = Math.max(...allVals, 1)
  const yTicks = 4
  const yStep = maxVal / yTicks

  // Sort by date if xCol is a date (reuse the precomputed colMeta flag)
  const xColIsDate = !!xCol && (colMeta.find((c) => c.col === xCol)?.date ?? false)
  const sorted =
    xColIsDate
      ? [...data].sort((a, b) => String(a[xCol] ?? '').localeCompare(String(b[xCol] ?? '')))
      : data

  function px(i: number, val: number) {
    const x = padL + (n <= 1 ? chartW / 2 : (i / (n - 1)) * chartW)
    const y = padT + chartH - (val / maxVal) * chartH
    return { x, y }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-label="Line chart">
      {/* Y grid + labels */}
      {Array.from({ length: yTicks + 1 }, (_, i) => {
        const val = yStep * i
        const y = padT + chartH - (val / maxVal) * chartH
        return (
          <g key={i}>
            <line x1={padL} y1={y} x2={padL + chartW} y2={y} stroke="currentColor" strokeOpacity={0.1} />
            <text x={padL - 4} y={y + 4} textAnchor="end" fontSize={9} fill="currentColor" fillOpacity={0.6}>
              {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : Math.round(val)}
            </text>
          </g>
        )
      })}

      {/* Lines + dots per series */}
      {numericCols.map((col, si) => {
        const color = COLORS[si % COLORS.length]
        const points = sorted.map((row, i) => {
          const { x, y } = px(i, toNum(row[col]))
          return `${x},${y}`
        })
        return (
          <g key={col}>
            <polyline
              points={points.join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
            {sorted.map((row, i) => {
              const val = toNum(row[col])
              const { x, y } = px(i, val)
              const xLabel = xCol ? String(row[xCol] ?? i) : String(i + 1)
              return (
                <circle key={i} cx={x} cy={y} r={3.5} fill={color} opacity={0.95}>
                  <title>{`${col}: ${val} (${xLabel})`}</title>
                </circle>
              )
            })}
          </g>
        )
      })}

      {/* X-axis labels — every nth to avoid clutter */}
      {(() => {
        const step = Math.max(1, Math.ceil(n / 10))
        return sorted
          .filter((_, i) => i % step === 0 || i === n - 1)
          .map((row) => {
            const i = sorted.indexOf(row)
            const { x } = px(i, 0)
            const label = xCol ? shortLabel(row[xCol], 8) : String(i + 1)
            return (
              <text
                key={i}
                x={x}
                y={padT + chartH + 14}
                textAnchor="middle"
                fontSize={9}
                fill="currentColor"
                fillOpacity={0.7}
              >
                {label}
              </text>
            )
          })
      })()}

      {/* Axes */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="currentColor" strokeOpacity={0.3} />
      <line
        x1={padL}
        y1={padT + chartH}
        x2={padL + chartW}
        y2={padT + chartH}
        stroke="currentColor"
        strokeOpacity={0.3}
      />

      {/* Legend */}
      {numericCols.length > 1 &&
        numericCols.map((col, si) => (
          <g key={col} transform={`translate(${padL + si * 110}, ${H - 14})`}>
            <rect x={0} y={-8} width={10} height={10} fill={COLORS[si % COLORS.length]} rx={2} />
            <text x={14} y={0} fontSize={9} fill="currentColor" fillOpacity={0.8}>
              {shortLabel(col, 14)}
            </text>
          </g>
        ))}
    </svg>
  )
}

// ─── Pie Chart ──────────────────────────────────────────────────────────────

function PieChart({ data, colMeta }: ChartProps) {
  const numericCol = colMeta.find((c) => c.numeric)?.col
  const labelCol = colMeta.find((c) => !c.numeric)?.col ?? null

  if (!numericCol) return <NoData />

  const W = 300
  const H = 300
  const cx = 110
  const cy = 140
  const r = 100

  const total = data.reduce((sum, row) => sum + toNum(row[numericCol]), 0)
  if (total === 0) return <NoData />

  let angle = -Math.PI / 2 // start at top

  function polarToCartesian(a: number, radius = r) {
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) }
  }

  const slices = data.map((row, i) => {
    const val = toNum(row[numericCol])
    const fraction = val / total
    const sweep = fraction * 2 * Math.PI
    const startAngle = angle
    angle += sweep
    const endAngle = angle
    const largeArc = sweep > Math.PI ? 1 : 0

    const start = polarToCartesian(startAngle)
    const end = polarToCartesian(endAngle)

    // Label position — midpoint of arc
    const midAngle = startAngle + sweep / 2
    const labelR = r * 0.65
    const labelPos = polarToCartesian(midAngle, labelR)

    const d = [
      `M ${cx} ${cy}`,
      `L ${start.x} ${start.y}`,
      `A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`,
      'Z',
    ].join(' ')

    const label = labelCol ? String(row[labelCol] ?? '') : String(i + 1)
    const pct = Math.round(fraction * 100)

    return { d, label, val, pct, color: COLORS[i % COLORS.length], labelPos, fraction }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-label="Pie chart">
      {slices.map((s, i) => (
        <path key={i} d={s.d} fill={s.color} stroke="white" strokeWidth={1.5} opacity={0.9}>
          <title>{`${s.label}: ${s.val} (${s.pct}%)`}</title>
        </path>
      ))}

      {/* Inner value labels for slices > 8% */}
      {slices
        .filter((s) => s.fraction > 0.08)
        .map((s, i) => (
          <text
            key={i}
            x={s.labelPos.x}
            y={s.labelPos.y}
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize={9}
            fill="white"
            fontWeight="600"
          >
            {s.pct}%
          </text>
        ))}

      {/* Legend on the right */}
      {slices.map((s, i) => (
        <g key={i} transform={`translate(224, ${20 + i * 18})`}>
          <rect x={0} y={-8} width={10} height={10} fill={s.color} rx={2} />
          <text x={14} y={0} fontSize={9} fill="currentColor" fillOpacity={0.85}>
            {shortLabel(s.label, 8)} ({s.pct}%)
          </text>
        </g>
      ))}
    </svg>
  )
}

// ─── Fallback ───────────────────────────────────────────────────────────────

function NoData() {
  return (
    <div className="flex h-40 items-center justify-center text-sm text-gray-400 dark:text-gray-500">
      No numeric data to chart
    </div>
  )
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function ChartView({ data, columns }: ChartViewProps) {
  if (data.length === 0 || columns.length === 0) return <NoData />

  const colMeta = computeColMeta(data, columns)
  const chartType = detectChartType(colMeta, data.length)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
          {chartType === 'bar' ? 'Bar chart' : chartType === 'line' ? 'Line chart' : 'Pie chart'}
        </span>
        <span className="text-xs text-gray-300 dark:text-gray-600">
          {data.length} row{data.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="text-gray-800 dark:text-gray-200">
        {chartType === 'bar' && <BarChart data={data} colMeta={colMeta} />}
        {chartType === 'line' && <LineChart data={data} colMeta={colMeta} />}
        {chartType === 'pie' && <PieChart data={data} colMeta={colMeta} />}
      </div>
    </div>
  )
}
