// Client-side markdown → safe HTML renderer. Mirrors src/lib/markdown.ts (the
// server renderer) one-for-one so chat streams render identically on both sides.
// Escapes raw HTML before parsing, so the output is safe for innerHTML.
//
// Kept in sync with the server version by src/lib/markdown.test.ts, which imports
// this file and runs the same fixtures. Update both together.

function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Apply inline markup to already-escaped text.
function inline(s) {
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`)
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  s = s.replace(/___(.+?)___/g,        '<strong><em>$1</em></strong>')
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__(.+?)__/g,      '<strong>$1</strong>')
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>')
  s = s.replace(/_([^_\n]+?)_/g,   '<em>$1</em>')
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, text, url) => `<a href="${url}" rel="noopener noreferrer" target="_blank">${text}</a>`)
  return s
}

export function renderMarkdown(text) {
  const lines = text.split('\n')
  const out = []
  let i = 0

  while (i < lines.length) {
    const raw = lines[i]

    // Fenced code block
    if (raw.startsWith('```')) {
      const lang = esc(raw.slice(3).trim())
      const code = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        code.push(esc(lines[i]))
        i++
      }
      i++ // consume closing ```
      const cls = lang ? ` class="language-${lang}"` : ''
      out.push(`<pre><code${cls}>${code.join('\n')}</code></pre>`)
      continue
    }

    // Heading h1–h3
    const hMatch = raw.match(/^(#{1,3})\s+(.+)/)
    if (hMatch) {
      const lvl = hMatch[1].length
      out.push(`<h${lvl}>${inline(esc(hMatch[2]))}</h${lvl}>`)
      i++; continue
    }

    // Blockquote
    if (raw.startsWith('> ')) {
      out.push(`<blockquote>${inline(esc(raw.slice(2)))}</blockquote>`)
      i++; continue
    }

    // Unordered list
    if (raw.startsWith('- ') || raw.startsWith('* ')) {
      const items = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(`<li>${inline(esc(lines[i].slice(2)))}</li>`)
        i++
      }
      out.push(`<ul>${items.join('')}</ul>`)
      continue
    }

    // Ordered list
    if (/^\d+\.\s/.test(raw)) {
      const items = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        const m = lines[i].match(/^\d+\.\s+(.+)/)
        items.push(`<li>${inline(esc(m?.[1] ?? ''))}</li>`)
        i++
      }
      out.push(`<ol>${items.join('')}</ol>`)
      continue
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(raw.trim())) {
      out.push('<hr>'); i++; continue
    }

    // Empty line
    if (raw.trim() === '') {
      out.push(''); i++; continue
    }

    // Paragraph
    out.push(`<p>${inline(esc(raw))}</p>`)
    i++
  }

  return out.join('\n')
}

// Expose for the page scripts (loaded via <script type="module" src="/md.js">).
if (typeof window !== 'undefined') window.renderMd = renderMarkdown
