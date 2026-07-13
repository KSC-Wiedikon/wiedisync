/**
 * Strip HTML tags and return plain text (for previews / truncated display).
 *
 * Lives apart from `components/RichText.tsx` so that file only exports the
 * component — react-refresh/only-export-components (Fast Refresh) requires a
 * module to export either components or non-components, not both.
 */
export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent?.trim() ?? ''
}
