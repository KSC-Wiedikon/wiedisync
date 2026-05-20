import { useRef, useEffect, useMemo } from 'react'
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { basicSetup } from 'codemirror'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { autocompletion, startCompletion } from '@codemirror/autocomplete'
import { oneDark } from '@codemirror/theme-one-dark'
import { useTheme } from '@/hooks/useTheme'

export interface SqlSchemaColumn {
  name: string
  /** Column type — shown in autocomplete popup as the suggestion's detail. */
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

interface RichCompletion {
  label: string
  type?: string
  detail?: string
}

/** Build the lang-sql `schema` map. Each table maps to its columns as rich
 *  completion entries (label + type marker + dataType detail), giving us a
 *  proper autocomplete popup with column types when the user types `tbl.`. */
function buildSchema(
  tables: readonly SqlSchemaTable[],
): Record<string, readonly RichCompletion[]> {
  const schema: Record<string, RichCompletion[]> = {}
  for (const t of tables) {
    schema[t.name] = t.columns.map((c) => ({
      label: c.name,
      type: 'property',
      detail: c.dataType,
    }))
  }
  return schema
}

function buildTablesList(
  tables: readonly SqlSchemaTable[],
): RichCompletion[] {
  return tables.map((t) => ({ label: t.name, type: 'type' }))
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
  const sqlCompartment = useRef(new Compartment())
  const { theme } = useTheme()

  onExecuteRef.current = onExecute
  onChangeRef.current = onChange

  const schema = useMemo(() => buildSchema(tables), [tables])
  const tableList = useMemo(() => buildTablesList(tables), [tables])

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
        sqlCompartment.current.of(
          sql({ dialect: PostgreSQL, schema, tables: tableList, upperCaseKeywords: true }),
        ),
        autocompletion({ activateOnTyping: true, defaultKeymap: true }),
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
          '&': { fontSize: '13px' },
          '.cm-content': { fontFamily: 'ui-monospace, "JetBrains Mono", monospace' },
          '.cm-gutters': { borderRight: 'none' },
          '.cm-scroller': { minHeight: '160px' },
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

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: sqlCompartment.current.reconfigure(
        sql({ dialect: PostgreSQL, schema, tables: tableList, upperCaseKeywords: true }),
      ),
    })
  }, [schema, tableList])

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
    <div
      ref={containerRef}
      className="overflow-hidden rounded-lg border border-border bg-card [&_.cm-editor]:min-h-[160px] [&_.cm-editor]:resize-y [&_.cm-editor]:overflow-auto"
    />
  )
}
