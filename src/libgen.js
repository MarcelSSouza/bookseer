'use strict';
// Libgen.li client: free-text search + direct download link resolution.
// Much better coverage for non-English (esp. Portuguese) titles than the
// Usenet/torrent indexers in Prowlarr, which skew heavily English.

const BASE = process.env.LIBGEN_BASE || 'https://libgen.li';
const UA = { 'User-Agent': 'Mozilla/5.0 (BookSeer/0.1 self-hosted)' };

function extractEditions(html) {
  // Rows look like: <a data-toggle="tooltip" ... title="..." href="edition.php?id=1234">Title <i></i></a>
  // The href attribute is NOT first on the tag, so match it anywhere inside
  // an <a ...> and grab the plain text right after the closing '>'.
  const results = [];
  const re = /href="edition\.php\?id=(\d+)">([^<]+)/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(html))) {
    const id = m[1];
    const title = decodeEntities(m[2]);
    if (seen.has(id) || !title) continue;
    seen.add(id);
    results.push({ editionId: id, title });
  }
  return results;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

async function search(query) {
  const url = `${BASE}/index.php?req=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Libgen search failed: ${res.status}`);
  const html = await res.text();
  return extractEditions(html).map((e) => ({
    candidateId: `libgen:${e.editionId}`,
    editionId: e.editionId,
    title: e.title,
    size: null,
    indexer: 'Libgen',
    protocol: 'direct',
    seeders: null,
    publishDate: null,
  }));
}

async function resolveDownloadUrl(editionId) {
  const editionUrl = `${BASE}/edition.php?id=${editionId}`;
  const editionRes = await fetch(editionUrl, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!editionRes.ok) throw new Error(`Libgen edition fetch failed: ${editionRes.status}`);
  const editionHtml = await editionRes.text();
  const adsMatch = editionHtml.match(/href="\/?ads\.php\?md5=([a-f0-9]+)"/i);
  if (!adsMatch) throw new Error('Libgen: no download link found on edition page');
  const md5 = adsMatch[1];

  const adsUrl = `${BASE}/ads.php?md5=${md5}`;
  const adsRes = await fetch(adsUrl, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!adsRes.ok) throw new Error(`Libgen ads fetch failed: ${adsRes.status}`);
  const adsHtml = await adsRes.text();
  const getMatch = adsHtml.match(/href="(get\.php\?md5=[a-f0-9]+&key=[A-Z0-9]+)"/i);
  if (!getMatch) throw new Error('Libgen: no get.php link found');

  return `${BASE}/${getMatch[1]}`;
}

module.exports = { search, resolveDownloadUrl };
