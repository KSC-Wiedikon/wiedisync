import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Bold, Italic, List, ListOrdered, Quote, Link as LinkIcon, Heading2, Heading3 } from 'lucide-react'
import { useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { isSafeAppLink } from '../utils/sanitizeUrl'
import { usePrompt } from './ConfirmProvider'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: string
}

/**
 * TipTap-based rich-text editor producing HTML compatible with the
 * RichText sanitisation whitelist (p, br, strong, em, u, s, a, ul, ol,
 * li, h1-h3, blockquote, span).
 */
export default function RichTextEditor({ value, onChange, placeholder, minHeight = '8rem' }: Props) {
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

  const btn = (active: boolean) =>
    `inline-flex h-8 w-8 items-center justify-center rounded text-sm transition-colors ${
      active
        ? 'bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
    }`

  return (
    <div className="overflow-hidden rounded-md border border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-gray-200 bg-gray-50 px-1 py-1 dark:border-gray-700 dark:bg-gray-800">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive('bold'))} aria-label={t('editor.bold')}><Bold className="h-4 w-4" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive('italic'))} aria-label={t('editor.italic')}><Italic className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-gray-600" />
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive('heading', { level: 2 }))} aria-label={t('editor.heading2')}><Heading2 className="h-4 w-4" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btn(editor.isActive('heading', { level: 3 }))} aria-label={t('editor.heading3')}><Heading3 className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-gray-600" />
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive('bulletList'))} aria-label={t('editor.bulletList')}><List className="h-4 w-4" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive('orderedList'))} aria-label={t('editor.numberedList')}><ListOrdered className="h-4 w-4" /></button>
        <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btn(editor.isActive('blockquote'))} aria-label={t('editor.quote')}><Quote className="h-4 w-4" /></button>
        <span className="mx-1 h-5 w-px bg-gray-300 dark:bg-gray-600" />
        <button type="button" onClick={setLink} className={btn(editor.isActive('link'))} aria-label={t('editor.link')}><LinkIcon className="h-4 w-4" /></button>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
