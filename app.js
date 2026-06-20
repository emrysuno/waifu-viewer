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

function render() {
  const all = getAllImages()
  const picks = pickRandom(all, count)

  const gallery = document.getElementById('gallery')
  gallery.innerHTML = ''

  for (const pick of picks) {
    const link = document.createElement('a')
    link.href = pick.pageUrl || pick.url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'

    const img = document.createElement('img')
    img.src = pick.url
    img.alt = pick.alt || pick.source || 'image'
    img.referrerPolicy = 'no-referrer'

    link.appendChild(img)
    gallery.appendChild(link)
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
