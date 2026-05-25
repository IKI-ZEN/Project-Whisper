/**
 * Aether-Lite chart.js — zero-dep SVG chart generator
 *
 * Usage:
 *   import { chart } from '/chart.js'
 *   element.innerHTML = chart(data, { type: 'bar' })
 *
 * @module chart
 */

const PALETTE = ['#7c3aed','#a78bfa','#34d399','#f59e0b','#f87171','#60a5fa','#fb923c','#a3e635']

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function svgWrap(width, height, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="font-family:-apple-system,sans-serif">${content}</svg>`
}

function barChart(data, { width, height, label, max }) {
  const pad   = { top: 20, right: 20, bottom: 42, left: 44 }
  const cw    = width  - pad.left - pad.right
  const ch    = height - pad.top  - pad.bottom
  const bw    = Math.max(4, cw / data.length - 6)
  const xStep = cw / data.length
  const parts = []

  // Y-axis gridlines + labels (4 lines)
  for (let i = 0; i <= 4; i++) {
    const v = (max * i / 4)
    const y = pad.top + ch - (ch * i / 4)
    const lbl = max > 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(max < 10 ? 1 : 0)
    parts.push(`<line x1="${pad.left}" y1="${y}" x2="${pad.left + cw}" y2="${y}" stroke="#252530" stroke-width="1"/>`)
    parts.push(`<text x="${pad.left - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#4a4a60">${esc(lbl)}</text>`)
  }

  // Bars
  data.forEach((d, i) => {
    const bh  = max > 0 ? Math.max(1, (d.value / max) * ch) : 0
    const x   = pad.left + i * xStep + (xStep - bw) / 2
    const y   = pad.top  + ch - bh
    const col = PALETTE[i % PALETTE.length]
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" fill="${col}" rx="2"/>`)
    // X-axis label — truncate if too long
    const maxChars = Math.max(3, Math.floor(xStep / 6))
    const lbl = String(d.label).slice(0, maxChars)
    parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${pad.top + ch + 14}" text-anchor="middle" font-size="10" fill="#4a4a60">${esc(lbl)}</text>`)
  })

  // Axes
  parts.push(`<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + ch}" stroke="#252530" stroke-width="1"/>`)
  parts.push(`<line x1="${pad.left}" y1="${pad.top + ch}" x2="${pad.left + cw}" y2="${pad.top + ch}" stroke="#252530" stroke-width="1"/>`)

  // Title
  if (label) parts.push(`<text x="${width / 2}" y="14" text-anchor="middle" font-size="11" fill="#d8d8e8">${esc(label)}</text>`)

  return svgWrap(width, height, parts.join(''))
}

function lineChart(data, { width, height, label, max }) {
  const pad   = { top: 20, right: 20, bottom: 42, left: 44 }
  const cw    = width  - pad.left - pad.right
  const ch    = height - pad.top  - pad.bottom
  const xStep = cw / Math.max(1, data.length - 1)
  const parts = []

  // Gridlines
  for (let i = 0; i <= 4; i++) {
    const v = (max * i / 4)
    const y = pad.top + ch - (ch * i / 4)
    const lbl = max > 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(max < 10 ? 1 : 0)
    parts.push(`<line x1="${pad.left}" y1="${y}" x2="${pad.left + cw}" y2="${y}" stroke="#252530" stroke-width="1"/>`)
    parts.push(`<text x="${pad.left - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#4a4a60">${esc(lbl)}</text>`)
  }

  // Line path + points
  const pts = data.map((d, i) => {
    const x = pad.left + i * xStep
    const y = pad.top  + ch - (max > 0 ? (d.value / max) * ch : 0)
    return { x, y, d }
  })

  if (pts.length > 1) {
    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
    parts.push(`<path d="${pathD}" fill="none" stroke="#7c3aed" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`)

    // Area fill
    const areaD = `${pathD} L${pts[pts.length-1].x.toFixed(1)},${(pad.top+ch).toFixed(1)} L${pts[0].x.toFixed(1)},${(pad.top+ch).toFixed(1)} Z`
    parts.push(`<path d="${areaD}" fill="#7c3aed" fill-opacity="0.12"/>`)
  }

  pts.forEach((p, i) => {
    parts.push(`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${PALETTE[i % PALETTE.length]}" stroke="#0c0c0f" stroke-width="2"/>`)
    const maxChars = Math.max(3, Math.floor(xStep / 6))
    const lbl = String(p.d.label).slice(0, maxChars)
    parts.push(`<text x="${p.x.toFixed(1)}" y="${pad.top + ch + 14}" text-anchor="middle" font-size="10" fill="#4a4a60">${esc(lbl)}</text>`)
  })

  // Axes
  parts.push(`<line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + ch}" stroke="#252530" stroke-width="1"/>`)
  parts.push(`<line x1="${pad.left}" y1="${pad.top + ch}" x2="${pad.left + cw}" y2="${pad.top + ch}" stroke="#252530" stroke-width="1"/>`)

  if (label) parts.push(`<text x="${width / 2}" y="14" text-anchor="middle" font-size="11" fill="#d8d8e8">${esc(label)}</text>`)

  return svgWrap(width, height, parts.join(''))
}

function pieChart(data, { width, height, label }) {
  const cx = width  / 2
  const cy = (height - 20) / 2 + 16
  const r  = Math.min(cx, cy - 16) - 20
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const parts = []

  let startAngle = -Math.PI / 2
  data.forEach((d, i) => {
    const slice    = (d.value / total) * Math.PI * 2
    const endAngle = startAngle + slice
    const mx  = cx + Math.cos(startAngle) * r
    const my  = cy + Math.sin(startAngle) * r
    const ex  = cx + Math.cos(endAngle)   * r
    const ey  = cy + Math.sin(endAngle)   * r
    const big = slice > Math.PI ? 1 : 0
    const col = PALETTE[i % PALETTE.length]

    parts.push(`<path d="M${cx},${cy} L${mx.toFixed(2)},${my.toFixed(2)} A${r},${r} 0 ${big},1 ${ex.toFixed(2)},${ey.toFixed(2)} Z" fill="${col}" stroke="#0c0c0f" stroke-width="2"/>`)

    // Label at midpoint of arc
    const mid = startAngle + slice / 2
    const lx  = cx + Math.cos(mid) * r * 0.65
    const ly  = cy + Math.sin(mid) * r * 0.65
    if (slice > 0.3) {
      const pct = Math.round(d.value / total * 100)
      parts.push(`<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" font-weight="600" fill="#fff">${pct}%</text>`)
    }
    startAngle = endAngle
  })

  // Legend
  const legendY = cy + r + 16
  const lw      = Math.min(width / data.length, 90)
  data.forEach((d, i) => {
    const lx = (i - data.length / 2 + 0.5) * lw + cx
    parts.push(`<rect x="${(lx - 5).toFixed(1)}" y="${legendY}" width="8" height="8" rx="2" fill="${PALETTE[i % PALETTE.length]}"/>`)
    const lbl = String(d.label).slice(0, Math.max(3, Math.floor(lw / 7)))
    parts.push(`<text x="${(lx + 5).toFixed(1)}" y="${legendY + 7}" font-size="9" fill="#4a4a60">${esc(lbl)}</text>`)
  })

  if (label) parts.push(`<text x="${cx}" y="12" text-anchor="middle" font-size="11" fill="#d8d8e8">${esc(label)}</text>`)

  return svgWrap(width, height, parts.join(''))
}

/**
 * Generate an SVG chart from data.
 * @param {Array<{label: string, value: number}>} data
 * @param {{ type?: 'bar'|'line'|'pie', width?: number, height?: number, label?: string }} [opts]
 * @returns {string} SVG markup — set as element.innerHTML
 */
export function chart(data, { type = 'bar', width = 400, height = 240, label = '' } = {}) {
  if (!data || data.length === 0)
    return svgWrap(width, height, `<text x="20" y="24" font-size="13" fill="#4a4a60">No data</text>`)

  const max = Math.max(...data.map(d => Number(d.value) || 0), 0)

  if (type === 'pie')  return pieChart(data, { width, height, label })
  if (type === 'line') return lineChart(data, { width, height, label, max })
  return barChart(data, { width, height, label, max })
}
