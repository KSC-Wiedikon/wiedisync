// ── Live merge-token highlighting in the rich-text editor ────────────────────
//
// Colours every `{{token}}` as you type: recognised ones blue, unrecognised
// ones red-struck. The point is not decoration — it is that the composer can
// otherwise give no sign whether `{{first_name}}` will be substituted or sent
// verbatim, and the difference is invisible until a member reads it.
//
// A ProseMirror decoration rather than a mark: decorations are presentation
// only and never enter the document, so highlighting can never leak into the
// HTML that gets emailed.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import type { Node as PMNode } from '@tiptap/pm/model'
import { MERGE_TOKENS } from '../utils/mergeTokens'

const TOKEN_RE = /\{\{\s*([^{}]*?)\s*\}\}/g

const KNOWN_CLASS =
  'rounded bg-brand-100 px-0.5 text-brand-700 dark:bg-brand-500/25 dark:text-brand-200'
const UNKNOWN_CLASS =
  'rounded bg-red-100 px-0.5 text-red-700 line-through decoration-red-400 dark:bg-red-500/25 dark:text-red-300'

function buildDecorations(doc: PMNode): DecorationSet {
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const m of node.text.matchAll(TOKEN_RE)) {
      const from = pos + (m.index ?? 0)
      const to = from + m[0].length
      const known = Object.prototype.hasOwnProperty.call(
        MERGE_TOKENS, (m[1] ?? '').trim().toLowerCase(),
      )
      decos.push(Decoration.inline(from, to, {
        class: known ? KNOWN_CLASS : UNKNOWN_CLASS,
        title: known ? undefined : 'This is not a known field — it will be sent exactly as written',
      }))
    }
  })
  return DecorationSet.create(doc, decos)
}

export const MergeTokenHighlight = Extension.create({
  name: 'mergeTokenHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('mergeTokenHighlight'),
        state: {
          init: (_config, state: EditorState) => buildDecorations(state.doc),
          // Recomputed only when the document actually changed — a selection
          // move must not rebuild decorations on every arrow key.
          apply: (tr, old) => (tr.docChanged ? buildDecorations(tr.doc) : old),
        },
        props: {
          decorations(state) { return this.getState(state) },
        },
      }),
    ]
  },
})
