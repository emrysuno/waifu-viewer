const STORAGE_KEY = 'waifu-fetcher-count'

function loadCount() {
  const saved = localStorage.getItem(STORAGE_KEY)
  const n = parseInt(saved, 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function saveCount(n) {
  localStorage.setItem(STORAGE_KEY, String(n))
}

let count = loadCount()

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

// Random pastel-ish HSL so placeholders don't look jarring while loading.
function randomPlaceholderColor() {
  // const hue = Math.floor(Math.random() * 360)
  // return `hsl(${hue}, 35%, 22%)`
  return '#000000'
}

function buildTile(pick) {
  const link = document.createElement('a')
  link.href = pick.pageUrl || pick.url
  link.rel = 'noopener noreferrer'
  link.className = 'tile'
  link.addEventListener('click', (e) => {
    e.preventDefault(); // Stops left-click from opening the link
  });
  link.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // Stops the browser's right-click menu
    window.open(pick.pageUrl || pick.url, '_blank', 'noopener,noreferrer');
  });

  // Reserve the image's footprint up front using its known aspect ratio,
  // so nothing reflows later regardless of how slowly (or whether) it loads.
  const width = pick.width || 0
  const height = pick.height || 0
  if (width > 0 && height > 0) {
    link.style.aspectRatio = `${width} / ${height}`
  } else {
    // Unknown dimensions (older cached entries without width/height): fall
    // back to a reasonable default so the box still doesn't collapse to 0.
    link.style.aspectRatio = '3 / 4'
  }
  link.style.background = randomPlaceholderColor()

  const img = document.createElement('img')
  img.alt = pick.alt || pick.source || 'image'
  img.referrerPolicy = 'no-referrer'
  img.loading = 'lazy'
  img.decoding = 'async'

  // Image stays invisible (placeholder shows through) until it has
  // actually finished loading, then fades in. No load = no shift, no alt
  // text appearing out of nowhere, and the box never changes size.
  img.addEventListener('load', () => {
    img.classList.add('loaded')
  })
  img.addEventListener('error', () => {
    // Don't fall back to alt text inside a flexible box (the browser will
    // resize the box's content area to fit the text otherwise on some
    // engines). Instead mark the tile as failed and just keep showing the
    // colored placeholder, sized exactly the same as every other tile.
    link.classList.add('failed')
  })

  // Set src last, after listeners are attached.
  img.src = pick.sample_url || pick.url

  link.appendChild(img)
  return link
}

function render() {
  const all = getAllImages()
  const n = Math.min(count, all.length)
  if (all.length < count) {
    console.warn(`requested ${count} but only ${all.length} image(s) available in IMAGE_STORE`)
  }
  const picks = pickRandom(all, n)

  const gallery = document.getElementById('gallery')
  gallery.innerHTML = ''

  for (const pick of picks) {
    gallery.appendChild(buildTile(pick))
  }

  document.title = `Waifu Fetcher (${count})`
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
}

main()
