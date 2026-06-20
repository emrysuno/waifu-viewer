// zoom.js
// Right-click an image in #gallery to zoom it in a fullscreen lightbox.
// Left-click is untouched, so it still opens the image's source link (app.js sets that up).
// Close the lightbox by clicking it, pressing Escape, or right-clicking it again.

(function () {
  let overlay = null
  let overlayImg = null

  function buildOverlay() {
    overlay = document.createElement('div')
    overlay.id = 'zoom-overlay'
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      background: 'rgba(0, 0, 0, 0.92)',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '9999',
      cursor: 'zoom-out',
      padding: '24px',
      boxSizing: 'border-box',
    })

    overlayImg = document.createElement('img')
    Object.assign(overlayImg.style, {
      maxWidth: '100%',
      maxHeight: '100%',
      objectFit: 'contain',
      boxShadow: '0 0 40px rgba(0, 0, 0, 0.7)',
    })
    overlayImg.referrerPolicy = 'no-referrer'

    overlay.appendChild(overlayImg)

    // Left-click or right-click on the overlay closes it.
    overlay.addEventListener('click', closeZoom)
    overlay.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      closeZoom()
    })

    document.body.appendChild(overlay)
  }

  function openZoom(src, alt) {
    if (!overlay) buildOverlay()
    overlayImg.src = src
    overlayImg.alt = alt || ''
    overlay.style.display = 'flex'
    document.body.style.overflow = 'hidden'
  }

  function closeZoom() {
    if (!overlay || overlay.style.display === 'none') return
    overlay.style.display = 'none'
    overlayImg.src = ''
    document.body.style.overflow = ''
  }

  function onContextMenu(e) {
    const img = e.target.closest('#gallery img')
    if (!img) return
    e.preventDefault()
    openZoom(img.currentSrc || img.src, img.alt)
  }

  function onKeydown(e) {
    if (e.key === 'Escape') closeZoom()
  }

  // Event delegation: works even though the gallery's <img> elements
  // are created dynamically by app.js after this script loads.
  document.addEventListener('contextmenu', onContextMenu)
  document.addEventListener('keydown', onKeydown)
})()
