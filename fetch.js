import fs from 'fs'

const DATA_FILE = 'image.js'
const limit = 1000

async function fetchImages({
  url, // full request url
  getItems, // (data) => array of items
  getImageUrl, // (item) => image url string
  getPageUrl, // (item) => original page url string
  getId, // (item) => unique id for this item
  getExtraFields, // (item) => optiona object with extra fields
} = {}) {
  const res = await fetch(url)
  const data = await res.json()
  const items = getItems(data) || []
  return items.map(item => ({
    url: getImageUrl(item),
    pageUrl: getPageUrl ? getPageUrl(item) : null,
    id: String(getId(item)),
    ...(getExtraFields ? getExtraFields(item) : {})
  }))
}

// Source waifu.im.
// https://docs.waifu.im/docs/intro
function fetchWaifuIm() {
  return fetchImages({
    url: `https://api.waifu.im/images?pagesize=${limit}`,
    getItems: (data) => data?.items,
    getImageUrl: (post) => post.url,
    getPageUrl: (post) => `https://waifu.im/images/${post.id}`,
    getId: (post) => post.id,
  })
}

// Source danbooru.
// https://danbooru.donmai.us/wiki_pages/help:api
// function fetchDanbooru() {
//   return fetchImages({
//     url: `https://danbooru.donmai.us/posts.json?limit=${limit}`,
//     getItems: (data) => data,
//     getImageUrl: (post) => post.file_url,
//     getAlt: (post) => post.tag_string_character,
//     getPageUrl: (post) => `https://danbooru.donmai.us/posts/${post.id}`,
//     getId: (post) => post.id,
//   })
// }

// Source safebooru.
// https://safebooru.org/index.php?page=help&topic=dapi
// function fetchSafebooru() {
//   return fetchImages({
//     url: `https://safebooru.org/index.php?json=1&page=dapi&s=post&q=index&limit=${limit}`,
//     getItems: (data) => data,
//     getImageUrl: (post) => post.file_url,
//     getAlt: (post) => post.tag_string_character,
//     getPageUrl: (post) => `https://danbooru.donmai.us/posts/${post.id}`,
//   })
// }

// Source yande.re.
// https://yande.re/help/api
function fetchYandere() {
  return fetchImages({
    url: `https://yande.re/post.json?limit=${limit}`,
    getItems: (data) => data,
    getImageUrl: (post) => post.file_url,
    getPageUrl: (post) => `https://yande.re/post/show/${post.id}`,
    getId: (post) => post.id,
    getExtraFields: (post) => ({ sample_url: post.sample_url || null })
  })
}

// # Source konachan.com (NSFW version).
// # https://konachan.com/help/api
// function fetchKonachancom() {
//   return fetchImages({
//     url: `https://konachan.com/post.json?limit=${limit}`,
//     getItems: (data) => data,
//     getImageUrl: (post) => post.file_url,
//     getAlt: (post) => post.author,
//     getPageUrl: (post) => `https://konachan.com/post/show/${post.id}`,
//   })
// }

// # Source konachan.net (SFW version).
// # https://konachan.net/help/api
// TODO: exclude tags: animal no-humans pokemon chibi
function fetchKonachannet() {
  return fetchImages({
    url: `https://konachan.net/post.json?limit=${limit}`,
    getItems: (data) => data,
    getImageUrl: (post) => post.file_url,
    getPageUrl: (post) => `https://konachan.net/post/show/${post.id}`,
    getId: (post) => post.id,
    getExtraFields: (post) => ({ sample_url: post.sample_url || null })
  })
}

// Source zerochan.
// https://www.zerochan.net/api
// function fetchZerochan() {
//   return fetchImages({
//     url: `https://www.zerochan.net/?json&l=${limit}`,
//     getItems: (data) => data?.items,
//     getImageUrl: (post) => post.thumbnail,
//     getAlt: (post) => post.tag,
//     getPageUrl: (post) => `https://www.zerochan.net/${post.id}`,
//     getId: (post) => post.id,
//   })
// }

// Load existing JSON store, if any, so we can merge instead of overwrite.
async function loadExisting() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8')
    const jsonStr = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)
    return JSON.parse(jsonStr)
  } catch (err) {
    return {} // File missing or invalid JSON -> start fresh.
  }
}
// Merge newly-fetched items into the existing store, keyed by source -> id.
function mergeInto(store, sourceName, newItems) {
  if (!store[sourceName]) store[sourceName] = {}
  for (const item of newItems) {
    const { id, ...itemWithoutId } = item
    store[sourceName][id] = itemWithoutId
  }
}

async function main() {
  const sources = [
    { name: 'waifu.im', fetcher: fetchWaifuIm },
    // { name: 'danbooru', fetcher: fetchDanbooru },
    // { name: 'safebooru', fetcher: fetchSafebooru },
    { name: 'yande.re', fetcher: fetchYandere },
    // { name: 'konachancom', fetcher: fetchKonachancom },
    { name: 'konachannet', fetcher: fetchKonachannet },
    // { name: 'zerochan', fetcher: fetchZerochan },
  ]
  const store = await loadExisting()
  for (const { name, fetcher } of sources) {
    try {
      const items = await fetcher()
      mergeInto(store, name, items)
      console.log(`fetched ${items.length} item(s) frmo ${name}`)
    } catch (err) {
      console.error(`failed to fetch from ${name}`, err.message)
    }
  }
  const fileContents = `// Auto-generated by fetch.js — do not edit by hand.
    window.IMAGE_STORE = ${JSON.stringify(store, null, 2)}
  `
  fs.writeFileSync(DATA_FILE, fileContents)
  const total = Object.values(store).reduce(
    (sum, bySource) => sum + Object.keys(bySource).length,
    0
  )
  console.log(`store now has ${total} total image(s) across ${Object.keys(store).length} source(s)`)
}
main()
