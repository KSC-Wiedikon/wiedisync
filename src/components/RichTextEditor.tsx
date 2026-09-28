import IconButton from './IconButton'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, List, ListOrdered, Quote, Link as LinkIcon, Heading2, Heading3 } from 'lucide-react'
import { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { isSafeAppLink } from '../utils/sanitizeUrl'
import { usePrompt } from './ConfirmProvider'
import { MergeTokenHighlight } from './mergeTokenHighlight'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: string
  /** Colour `{{token}}` occurrences as you type — blue when the group send will
   *  substitute them, red-struck when it will send them verbatim. Off by
   *  default: only the group composer has merge fields, and everywhere else a
   *  literal `{{…}}` is just text. */
  highlightMergeTokens?: boolean
}

/**
 * TipTap-based rich-text editor producing HTML compatible with the
 * RichText sanitisation whitelist (p, br, strong, em, u, s, a, ul, ol,
 * li, h1-h3, blockquote, span).
 */
export default function RichTextEditor({ value, onChange, placeholder, minHeight = '8rem', highlightMergeTokens = false }: Props) {
  const { t } = useTranslation('common')
  const prompt = usePrompt()
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      ...(highlightMergeTokens ? [MergeTokenHighlight] : []),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      onChange(html === '<p></p>' ? '' : html)
    },
    editorProps: {
      attributes: {
        // break-words (overflow-wrap is inherited) so a long unbroken string —
        // e.g. a pasted URL or "aaaa…" — wraps inside the box instead of
        // overflowing past the right edge.
        class: 'prose prose-sm max-w-none dark:prose-invert focus:outline-none px-3 py-2 break-words [overflow-wrap:anywhere]',
        style: `min-height: ${minHeight}`,
      },
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const next = value || ''
    if (current !== next && next !== '<p></p>') {
      editor.commands.setContent(next, { emitUpdate: false })
    }
  }, [value, editor])

  const setLink = useCallback(async () => {
    if (!editor) return
    const previous = editor.getAttributes('link').href as string | undefined
    const url = await prompt({ message: t('linkUrl'), defaultValue: previous ?? '' })
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    // Reject anything that isn't an https URL or a same-origin "/path" — keeps
    // `javascript:`/`data:` out of the stored HTML at rest.
    if (!isSafeAppLink(url.trim())) return
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }, [editor, prompt, t])

  if (!editor) return null

  // Toolbar toggles on the dense icon tier (36px phone / 32px sm+).
  const btn = (active: boolean) =>
    active
      ? 'bg-selected text-selected-foreground hover:bg-selected/90 hover:text-selected-foreground'
      : 'text-muted-foreground hover:bg-accent'

  return (
    <div className="overflow-hidden rounded-lg border border-input bg-card focus-within:ring-2 focus-within:ring-ring dark:bg-input/20">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-sunken px-1 py-1">
        <IconButton type="button" size="sm" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))} aria-pressed={editor.isActive('bold')} label={t('editor.bold')}><Bold /></IconButton>
        <IconButton type="button" size="sm" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))} aria-pressed={editor.isActive('italic')} label={t('editor.italic')}><Italic /></IconButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <IconButton type="button" size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive('heading', { level: 2 }))} aria-pressed={editor.isActive('heading', { level: 2 })} label={t('editor.heading2')}><Heading2 /></IconButton>
        <IconButton type="button" size="sm" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btn(editor.isActive('heading', { level: 3 }))} aria-pressed={editor.isActive('heading', { level: 3 })} label={t('editor.heading3')}><Heading3 /></IconButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <IconButton type="button" size="sm" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))} aria-pressed={editor.isActive('bulletList')} label={t('editor.bulletList')}><List /></IconButton>
        <IconButton type="button" size="sm" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))} aria-pressed={editor.isActive('orderedList')} label={t('editor.numberedList')}><ListOrdered /></IconButton>
        <IconButton type="button" size="sm" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btn(editor.isActive('blockquote'))} aria-pressed={editor.isActive('blockquote')} label={t('editor.quote')}><Quote /></IconButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <IconButton type="button" size="sm" onClick={setLink} className={btn(editor.isActive('link'))} aria-pressed={editor.isActive('link')} label={t('editor.link')}><LinkIcon /></IconButton>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
