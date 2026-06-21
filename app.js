const STORAGE_KEY = 'waifu-fetcher-count'

// Floor on cell size, in pixels, along whichever axis we're splitting.
// Keeps BSP from ever producing a sliver cell.
const MIN_CELL_PX = 120

// Hard bounds on any single split fraction. Ratio-matching is only allowed
// to nudge the split within this window -- it can never produce a 90/10
// blowout just because some image's aspect ratio "wants" that. Worst case
// any one image ends up about 70/30 vs. its neighbor; in practice repeated
// splits average out closer to even.
const MIN_SPLIT_FRAC = 0.30
const MAX_SPLIT_FRAC = 0.70

// Past this much log-ratio mismatch between a cell and its assigned image,
// cropping with `cover` would slice off too much of the image. Render that
// tile with `contain` + a plain background fill instead, gaps and all.
const MAX_COVER_LOG_RATIO = 0.6

function loadCount() {
  const saved = localStorage.getItem(STORAGE_KEY)
  const n = parseInt(saved, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function saveCount(n) {
  localStorage.setItem(STORAGE_KEY, String(n))
}

let count = loadCount()
let currentPicks = [] // images chosen for the current render, kept stable across resize
let currentCells = [] // {x,y,w,h} in viewport px, kept stable across resize-driven re-layout

function getAllImages() {
  const store = window.IMAGE_STORE || {}
  return Object.entries(store).flatMap(([source, byId]) =>
    Object.values(byId).map(item => ({ ...item, source }))
  )
}

function pickRandom(arr, n) {
  const copy = arr.slice()
  const picks = []
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length)
    picks.push(copy[idx])
    copy.splice(idx, 1)
  }
  return picks
}

function imageRatio(pick) {
  const w = pick.width || 0
  const h = pick.height || 0
  if (w > 0 && h > 0) return w / h
  return 3 / 4 // same fallback the old code used for unknown dimensions
}

// --- Recursive split (BSP) -------------------------------------------------
//
// Splits a viewport-sized rect into `n` cells. Each split is biased toward
// the aspect ratios actually present in `picks`, so the resulting cell
// shapes tend to resemble images we have on hand (fewer/smaller crops later)
// rather than being arbitrary.

function rectRatio(r) {
  return r.w / r.h
}

// How "distorted" a rect is, used to decide which rect to split next
// (always split the most distorted one first) and to choose split axis.
function distortion(r) {
  const ratio = rectRatio(r)
  return Math.max(ratio, 1 / ratio)
}

function sampleTargetRatio(picks) {
  const pick = picks[Math.floor(Math.random() * picks.length)]
  return imageRatio(pick)
}

// Given a rect and a target ratio for ONE of the two children, find a split
// fraction (0-1) along the chosen axis that makes that child's ratio as
// close to target as possible, while respecting both the pixel floor and
// the area-balance window (MIN_SPLIT_FRAC..MAX_SPLIT_FRAC).
function fractionForTargetRatio(r, axis, target) {
  let frac
  if (axis === 'v') {
    // vertical split -> two side-by-side rects, widths sum to r.w
    // child ratio = (frac * r.w) / r.h = target  =>  frac = target * r.h / r.w
    frac = (target * r.h) / r.w
  } else {
    // horizontal split -> two stacked rects, heights sum to r.h
    // child ratio = r.w / (frac * r.h) = target  =>  frac = r.w / (target * r.h)
    frac = r.w / (target * r.h)
  }
  if (!Number.isFinite(frac)) frac = 0.5

  const pixelMinFrac = MIN_CELL_PX / (axis === 'v' ? r.w : r.h)
  const lo = Math.max(MIN_SPLIT_FRAC, pixelMinFrac)
  const hi = Math.min(MAX_SPLIT_FRAC, 1 - pixelMinFrac)
  if (lo > hi) return 0.5 // rect too small for both constraints at once; just bisect
  return Math.max(lo, Math.min(hi, frac))
}

function canSplit(r) {
  return r.w >= MIN_CELL_PX * 2 || r.h >= MIN_CELL_PX * 2
}

function splitRect(r, picks) {
  // Pick axis based on which dimension has more room AND would most reduce
  // distortion: split along the longer relative axis.
  const canV = r.w >= MIN_CELL_PX * 2
  const canH = r.h >= MIN_CELL_PX * 2
  let axis
  if (canV && canH) axis = (r.w / r.h >= 1) ? 'v' : 'h'
  else if (canV) axis = 'v'
  else axis = 'h'

  const target = sampleTargetRatio(picks)
  const frac = fractionForTargetRatio(r, axis, target)

  if (axis === 'v') {
    const w1 = r.w * frac
    return [
      { x: r.x, y: r.y, w: w1, h: r.h },
      { x: r.x + w1, y: r.y, w: r.w - w1, h: r.h },
    ]
  } else {
    const h1 = r.h * frac
    return [
      { x: r.x, y: r.y, w: r.w, h: h1 },
      { x: r.x, y: r.y + h1, w: r.w, h: r.h - h1 },
    ]
  }
}

function rectArea(r) {
  return r.w * r.h
}

function buildCells(n, viewportW, viewportH, picks) {
  let rects = [{ x: 0, y: 0, w: viewportW, h: viewportH }]

  while (rects.length < n) {
    // Always split the LARGEST splittable rect first. This is what bounds
    // size imbalance between cells: a rect can never sit around unsplit
    // while others get carved into slivers, because as soon as it becomes
    // the biggest one again, it's next in line.
    let bestIdx = -1
    let bestArea = -Infinity
    for (let i = 0; i < rects.length; i++) {
      if (!canSplit(rects[i])) continue
      const area = rectArea(rects[i])
      if (area > bestArea) {
        bestArea = area
        bestIdx = i
      }
    }
    if (bestIdx === -1) break // nothing left splittable above the floor

    const [a, b] = splitRect(rects[bestIdx], picks)
    rects.splice(bestIdx, 1, a, b)
  }

  return rects
}

// --- Assignment -------------------------------------------------------------
//
// Greedily pair cells to images by aspect ratio so the closest-fitting image
// goes to each cell, minimizing total crop. Cells with the most "extreme"
// ratios are matched first since they have the fewest good options.

function assignImagesToCells(cells, picks) {
  // Defensive: buildCells can return fewer cells than requested (the pixel
  // floor stops splitting early on small viewports / high counts). Never
  // index past however many images we actually have to give out.
  const remaining = picks.slice()
  const order = cells
    .map((c, i) => ({ i, ratio: rectRatio(c), extremity: distortion(c) }))
    .sort((a, b) => b.extremity - a.extremity)

  const result = new Array(cells.length)
  for (const { i, ratio } of order) {
    if (remaining.length === 0) break // shouldn't happen (cells.length <= picks.length), but stay safe
    let bestJ = 0
    let bestDiff = Infinity
    for (let j = 0; j < remaining.length; j++) {
      const diff = Math.abs(Math.log(imageRatio(remaining[j]) / ratio))
      if (diff < bestDiff) {
        bestDiff = diff
        bestJ = j
      }
    }
    result[i] = remaining.splice(bestJ, 1)[0]
  }
  return result
}

// --- Rendering ---------------------------------------------------------------

function buildTile(rect, pick) {
  const link = document.createElement('a')
  link.href = pick.pageUrl || pick.url
  link.rel = 'noopener noreferrer'
  link.className = 'tile'
  link.addEventListener('click', (e) => {
    e.preventDefault()
  })
  link.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    window.open(pick.pageUrl || pick.url, '_blank', 'noopener,noreferrer')
  })

  link.style.position = 'absolute'
  link.style.left = rect.x + 'px'
  link.style.top = rect.y + 'px'
  link.style.width = rect.w + 'px'
  link.style.height = rect.h + 'px'
  link.style.background = '#000000'

  const img = document.createElement('img')
  img.alt = pick.alt || pick.source || 'image'
  img.referrerPolicy = 'no-referrer'
  img.loading = 'lazy'
  img.decoding = 'async'

  // If this cell's shape is too far from the image's actual aspect ratio,
  // cropping with `cover` would slice off a large chunk of the image.
  // Fall back to `contain` instead -- the image shows in full, letterboxed
  // by the plain background color, rather than getting butchered.
  const cellRatio = rect.w / rect.h
  const logRatioDiff = Math.abs(Math.log(cellRatio / imageRatio(pick)))
  img.style.objectFit = logRatioDiff > MAX_COVER_LOG_RATIO ? 'contain' : 'cover'

  img.addEventListener('load', () => {
    img.classList.add('loaded')
  })
  img.addEventListener('error', () => {
    link.classList.add('failed')
  })

  img.src = pick.sample_url || pick.url

  link.appendChild(img)
  return link
}

// Re-run the full pipeline: pick images, build cells, assign, render.
// Called on count change (and on load).
function render() {
  const all = getAllImages()
  const n = Math.min(count, all.length)
  if (all.length < count) {
    console.warn(`requested ${count} but only ${all.length} image(s) available in IMAGE_STORE`)
  }
  currentPicks = pickRandom(all, n)
  relayout()
  document.title = `Waifu Fetcher (${count})`
}

// Re-run just the geometry (BSP + assignment) against the current picks.
// Called on render() and on viewport resize, so resizing never reshuffles
// which images are showing -- only how the viewport is carved up.
function relayout() {
  const gallery = document.getElementById('gallery')
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight

  if (currentPicks.length === 0) {
    gallery.innerHTML = ''
    return
  }

  const cells = buildCells(currentPicks.length, viewportW, viewportH, currentPicks)
  if (cells.length < currentPicks.length) {
    console.warn(`requested ${currentPicks.length} cells but viewport only fits ${cells.length} above the ${MIN_CELL_PX}px floor; some picked images won't be shown`)
  }
  const assigned = assignImagesToCells(cells, currentPicks)
  currentCells = cells

  gallery.innerHTML = ''
  for (let i = 0; i < cells.length; i++) {
    gallery.appendChild(buildTile(cells[i], assigned[i]))
  }
}

let resizeTimer = null
function onResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(relayout, 100)
}

function main() {
  render()

  document.addEventListener('keydown', (e) => {
    if (e.key === '=') {
      count += 1
      saveCount(count)
      render()
    } else if (e.key === '-') {
      count = Math.max(1, count - 1)
      saveCount(count)
      render()
    }
  })

  window.addEventListener('resize', onResize)
}

main()
