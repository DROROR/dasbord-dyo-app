// Paste cleanup for the work-document editor.
//
// The editor is a plain contentEditable, so a paste from Google Docs, Word,
// ChatGPT or another page arrives with the source's own markup: <style> blocks,
// classes that collide with ours, <font> tags, and — the reason this file
// exists — hardcoded colours. A document pasted from a white page carries
// `color: #000` on every run, which is invisible against the dark theme, and
// that colour is then saved into the row and stays wrong for everyone.
//
// So the structure is kept (headings, bold/italic, lists, tables, links,
// images, emoji — emoji are ordinary characters and survive untouched) and only
// the presentation that belongs to the theme is dropped: colour, background,
// font family and font size. The result inherits the editor's own colours and
// therefore reads correctly in both light and dark mode.

/** Tags worth keeping. Anything else is unwrapped, so its text survives. */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'THEAD',
  'TBODY', 'TFOOT', 'TR', 'TD', 'TH', 'A', 'BLOCKQUOTE', 'CODE', 'PRE', 'HR',
  'IMG', 'SUB', 'SUP',
])

/** Dropped with their contents — markup that would style or script the app. */
const DROP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'TITLE', 'IFRAME', 'OBJECT',
  'EMBED', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'NOSCRIPT',
])

/**
 * Inline styles that carry meaning rather than theme. Colour, background and
 * font-family are deliberately absent: those are what make pasted text
 * unreadable in the other mode. font-size and font-weight stay, because a
 * heading copied from Google Docs or a web page is often just a styled <span>
 * — strip them and it lands as plain body text.
 */
const KEEP_STYLES = new Set([
  'text-align', 'font-weight', 'font-size', 'font-style', 'text-decoration',
  'text-decoration-line', 'vertical-align',
])

const ATTRS_BY_TAG: Record<string, string[]> = {
  A: ['href', 'title'],
  IMG: ['src', 'alt', 'width', 'height'],
  TD: ['colspan', 'rowspan'],
  TH: ['colspan', 'rowspan'],
}

function safeUrl(raw: string, allowData: boolean): string | null {
  const url = raw.trim()
  if (/^(https?:|mailto:|tel:)/i.test(url)) return url
  if (allowData && /^data:image\//i.test(url)) return url
  // Protocol-relative and same-page links are harmless; javascript: is not.
  if (/^(\/|#)/.test(url)) return url
  return null
}

function cleanStyle(element: Element): void {
  const style = element.getAttribute('style')
  if (!style) return
  const kept = style
    .split(';')
    .map(part => part.trim())
    .filter(part => {
      const name = part.split(':')[0]?.trim().toLowerCase()
      return name !== undefined && KEEP_STYLES.has(name)
    })
  if (kept.length) element.setAttribute('style', kept.join('; '))
  else element.removeAttribute('style')
}

function unwrap(element: Element): void {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) parent.insertBefore(element.firstChild, element)
  parent.removeChild(element)
}

// A URL, up to the first whitespace or bracket. Trailing sentence punctuation
// is given back, so "see https://x.com/a." does not swallow the full stop.
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`)\]}]+/gi
// A separate, non-global copy for the cheap pre-check: calling .test() on the
// global one would move its lastIndex and make the next node start mid-string.
const URL_PRESENT = /(?:https?:\/\/|www\.)/i

/**
 * Turns bare URLs in text into real links, so a pasted address is clickable
 * instead of being a string that looks like one. Text already inside an <a>,
 * or inside code, is left alone.
 */
function autoLink(root: ParentNode, doc: Document): void {
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const targets: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (!text.data || !URL_PRESENT.test(text.data)) continue
    if ((text.parentElement?.closest('a, code, pre')) != null) continue
    targets.push(text)
  }

  for (const text of targets) {
    const fragment = doc.createDocumentFragment()
    let cursor = 0
    for (const match of text.data.matchAll(URL_PATTERN)) {
      const start = match.index ?? 0
      let url = match[0]
      // Keep the sentence's punctuation out of the href.
      const trailing = url.match(/[.,;:!?]+$/)
      if (trailing) url = url.slice(0, -trailing[0].length)
      if (start > cursor) fragment.appendChild(doc.createTextNode(text.data.slice(cursor, start)))
      const anchor = doc.createElement('a')
      anchor.setAttribute('href', url.toLowerCase().startsWith('www.') ? `https://${url}` : url)
      anchor.setAttribute('target', '_blank')
      anchor.setAttribute('rel', 'noopener noreferrer')
      anchor.textContent = url
      fragment.appendChild(anchor)
      cursor = start + url.length
    }
    if (cursor < text.data.length) fragment.appendChild(doc.createTextNode(text.data.slice(cursor)))
    text.parentNode?.replaceChild(fragment, text)
  }
}

/**
 * Returns HTML safe to drop into the editor: same words, same emoji, same
 * structure, none of the source's colours, classes or scripts.
 */
export function sanitizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // A live NodeList would shift while we unwrap, so take a static snapshot and
  // work through it. Children are visited after their parent is unwrapped,
  // which is fine: unwrapping only moves them, it never detaches them.
  for (const element of Array.from(doc.body.querySelectorAll('*'))) {
    if (!element.isConnected) continue
    const tag = element.tagName.toUpperCase()

    if (DROP_TAGS.has(tag)) { element.remove(); continue }
    if (!ALLOWED_TAGS.has(tag)) { unwrap(element); continue }

    const allowed = ATTRS_BY_TAG[tag] ?? []
    for (const attr of Array.from(element.attributes)) {
      const name = attr.name.toLowerCase()
      if (name === 'style') continue
      if (!allowed.includes(name)) { element.removeAttribute(attr.name); continue }
      if (name === 'href' || name === 'src') {
        const url = safeUrl(attr.value, name === 'src')
        if (url === null) element.removeAttribute(attr.name)
        else element.setAttribute(attr.name, url)
      }
    }
    cleanStyle(element)

    // Links open away from the document; the editor is not a browser.
    if (tag === 'A' && element.getAttribute('href')) {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
    }
  }

  autoLink(doc.body, doc)
  return doc.body.innerHTML
}

/** Plain-text paste: keep the line breaks, and make any URL a real link. */
export function plainTextToHtml(text: string): string {
  const doc = new DOMParser().parseFromString('<body></body>', 'text/html')
  const lines = text.split(/\r\n|\r|\n/)
  lines.forEach((line, i) => {
    if (i > 0) doc.body.appendChild(doc.createElement('br'))
    // Via a text node, so < & > cannot become markup.
    if (line) doc.body.appendChild(doc.createTextNode(line))
  })
  autoLink(doc.body, doc)
  return doc.body.innerHTML
}
