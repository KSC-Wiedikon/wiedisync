import { useRef, useEffect, useMemo } from 'react'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import {
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from '@/hooks/useTheme'

export interface SqlSchemaColumn {
  name: string
  /** Postgres type, surfaced in the completion popup's detail line. */
  dataType?: string
}
export interface SqlSchemaTable {
  name: string
  columns: readonly SqlSchemaColumn[]
}

interface CodeMirrorEditorProps {
  value: string
  onChange: (value: string) => void
  onExecute: () => void
  tables: readonly SqlSchemaTable[]
  placeholder?: string
}

const SQL_KEYWORDS = [
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'ILIKE', 'IS', 'NULL',
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'CROSS', 'ON', 'USING',
  'GROUP', 'BY', 'HAVING', 'ORDER', 'ASC', 'DESC', 'LIMIT', 'OFFSET', 'DISTINCT',
  'AS', 'WITH', 'RECURSIVE',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'UNION', 'INTERSECT', 'EXCEPT', 'ALL', 'EXISTS', 'ANY', 'BETWEEN', 'COALESCE', 'CAST',
  'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'ARRAY_AGG', 'JSONB_AGG', 'JSON_AGG', 'STRING_AGG',
  'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'RETURNING',
  'TRUE', 'FALSE',
]

/** Build a schema-aware autocomplete source.
 *  - `<table>.<partial>` → only that table's columns (with type)
 *  - bare word in any other position → table names, deduped column names
 *    (with `from <table>` hint), and SQL keywords */
function makeCompletionSource(tables: readonly SqlSchemaTable[]): CompletionSource {
  // Pre-compute completion arrays for performance
  const tableCompletions: Completion[] = tables.map((t) => ({
    label: t.name,
    type: 'type',
    detail: 'table',
    boost: 5,
  }))

  // Columns keyed by name. If a name is in multiple tables, surface them all
  // as separate entries so users see e.g. "id (members)" + "id (teams)".
  const columnCompletions: Completion[] = []
  for (const t of tables) {
    for (const c of t.columns) {
      columnCompletions.push({
        label: c.name,
        apply: c.name,
        type: 'property',
        detail: c.dataType ? `${c.dataType} · ${t.name}` : t.name,
        info: c.dataType ? `${t.name}.${c.name} :: ${c.dataType}` : `${t.name}.${c.name}`,
        boost: 2,
      })
    }
  }

  // Per-table column lookup (for `tableName.` completion)
  const columnsByTable = new Map<string, Completion[]>()
  for (const t of tables) {
    columnsByTable.set(
      t.name.toLowerCase(),
      t.columns.map((c) => ({
        label: c.name,
        type: 'property',
        detail: c.dataType,
        info: c.dataType ? `${t.name}.${c.name} :: ${c.dataType}` : undefined,
        boost: 10,
      })),
    )
  }

  const keywordCompletions: Completion[] = SQL_KEYWORDS.map((k) => ({
    label: k,
    type: 'keyword',
    boost: -1,
  }))

  return (context: CompletionContext): CompletionResult | null => {
    // Case 1: `tableName.<cursor>` or `tableName.partial`
    // Look BEFORE the dot — find a `<word>.` sequence.
    const dotMatch = context.matchBefore(/\b([A-Za-z_][\w]*)\.([\w]*)$/)
    if (dotMatch) {
      const m = dotMatch.text.match(/^([A-Za-z_][\w]*)\.([\w]*)$/)
      if (m) {
        const [, tableName, partial] = m
        const cols = columnsByTable.get(tableName.toLowerCase())
        if (cols) {
          return {
            // Replace only the part AFTER the dot
            from: dotMatch.from + tableName.length + 1,
            to: dotMatch.from + tableName.length + 1 + partial.length,
            options: cols,
            validFor: /^\w*$/,
          }
        }
      }
    }

    // Case 2: bare word — suggest tables + columns + keywords
    const word = context.matchBefore(/[A-Za-z_]\w*/)
    if (!word) {
      if (!context.explicit) return null
      // Empty position, explicit (Ctrl-Space): still offer suggestions
      return {
        from: context.pos,
        options: [...tableCompletions, ...columnCompletions, ...keywordCompletions],
        validFor: /^\w*$/,
      }
    }
    if (word.from === word.to && !context.explicit) return null

    return {
      from: word.from,
      options: [...tableCompletions, ...columnCompletions, ...keywordCompletions],
      validFor: /^\w*$/,
    }
  }
}

export default function CodeMirrorEditor({
  value,
  onChange,
  onExecute,
  tables,
  placeholder,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const externalValueRef = useRef(value)
  const onExecuteRef = useRef(onExecute)
  const onChangeRef = useRef(onChange)
  const themeCompartment = useRef(new Compartment())
  const completionCompartment = useRef(new Compartment())
  const { theme } = useTheme()

  // Latest-callback refs. Written after commit (never during render) — the only
  // readers are the CodeMirror keymap handler and the updateListener, both of
  // which fire from editor events, i.e. always after the commit that wrote them.
  useEffect(() => {
    onExecuteRef.current = onExecute
    onChangeRef.current = onChange
  })

  const completionSource = useMemo(() => makeCompletionSource(tables), [tables])

  useEffect(() => {
    if (!containerRef.current) return

    const executeKeymap = keymap.of([
      {
        key: 'Ctrl-Enter',
        mac: 'Cmd-Enter',
        run: () => {
          onExecuteRef.current()
          return true
        },
      },
      {
        key: 'Ctrl-Space',
        run: (view) => {
          startCompletion(view)
          return true
        },
      },
    ])

    const state = EditorState.create({
      doc: value,
      extensions: [
        executeKeymap,
        basicSetup,
        // Wrap long lines instead of horizontal scrolling — on touch devices the
        // inner horizontal pan is unreachable (nested scroll containers swallow
        // the gesture), leaving long SQL cut off at both edges.
        EditorView.lineWrapping,
        // lang-sql for syntax highlighting only — we override completion
        // entirely below so column suggestions work at every position.
        sql({ dialect: PostgreSQL, upperCaseKeywords: true }),
        completionCompartment.current.of(
          autocompletion({
            activateOnTyping: true,
            defaultKeymap: true,
            maxRenderedOptions: 50,
            override: [completionSource],
          }),
        ),
        themeCompartment.current.of(theme === 'dark' ? oneDark : []),
        cmPlaceholder(placeholder || ''),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newValue = update.state.doc.toString()
            externalValueRef.current = newValue
            onChangeRef.current(newValue)
          }
        }),
        EditorView.theme({
          // Fill the (bounded, resizable) wrapper; `.cm-scroller` is the single
          // internal scroller — see the wrapper's className below.
          '&': { fontSize: '13px', height: '100%' },
          '.cm-content': { fontFamily: 'ui-monospace, "JetBrains Mono", monospace' },
          '.cm-gutters': { borderRight: 'none' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-tooltip-autocomplete': { fontFamily: 'ui-monospace, "JetBrains Mono", monospace' },
          '.cm-completionDetail': { color: '#94a3b8', fontStyle: 'normal', marginLeft: '0.75rem' },
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: themeCompartment.current.reconfigure(
        theme === 'dark' ? oneDark : [],
      ),
    })
  }, [theme])

  // Reconfigure the autocomplete source when the schema (re)loads so
  // column suggestions appear as soon as the schema fetch resolves.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: completionCompartment.current.reconfigure(
        autocompletion({
          activateOnTyping: true,
          defaultKeymap: true,
          maxRenderedOptions: 50,
          override: [completionSource],
        }),
      ),
    })
  }, [completionSource])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    if (value !== externalValueRef.current) {
      externalValueRef.current = value
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: value,
        },
      })
    }
  }, [value])

  return (
    // The wrapper is the bounded, user-resizable box: `resize-y` puts a drag
    // grip at the bottom edge, `overflow-hidden` clips to its bounds (and is
    // what makes `resize` take effect), and min/default/max heights bound it.
    // `.cm-editor` fills it (`h-full`) and `.cm-scroller` scrolls internally, so
    // a query taller than the box scrolls instead of being clipped.
    <div
      ref={containerRef}
      className="resize-y overflow-hidden rounded-lg border border-border bg-card min-h-[160px] h-[260px] max-h-[70vh] [&_.cm-editor]:h-full"
    />
  )
}
