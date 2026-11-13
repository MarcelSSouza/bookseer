'use strict';
// Libgen.li client: free-text search + direct download link resolution.
// Much better coverage for non-English (esp. Portuguese) titles than the
// Usenet/torrent indexers in Prowlarr, which skew heavily English.

const BASE = process.env.LIBGEN_BASE || 'https://libgen.li';
const UA = { 'User-Agent': 'Mozilla/5.0 (BookSeer/0.1 self-hosted)' };

function extractEditions(html) {
  // Each book is one <tr>...</tr> row. Column order (libgen.li):
  // title/author-link, author, publisher, year, language, pages, size, format, mirrors.
  // We pull the editionId+title from the title link, and the format from the
  // <td> right before the mirrors cell (the one containing ads.php links).
  const results = [];
  const seen = new Set();
  const trRe = /<tr>([\s\S]*?)<\/tr>/g;
  let trMatch;
  while ((trMatch = trRe.exec(html))) {
    const row = trMatch[1];
    const titleMatch = row.match(/href="edition\.php\?id=(\d+)">([^<]+)/);
    if (!titleMatch) continue;
    const id = titleMatch[1];
    const title = decodeEntities(titleMatch[2]);
    if (seen.has(id) || !title) continue;

    // Format: a bare <td>word</td> immediately followed by the mirrors cell,
    // whose very first link goes to ads.php. Must NOT lazily skip across
    // other <td> cells (e.g. pages, size) to find a later ads.php link.
    const formatMatch = row.match(/<td>([a-zA-Z0-9]{2,6})<\/td>\s*<td>\s*<nobr>\s*<a[^>]*href="\/?ads\.php/);
    const format = formatMatch ? formatMatch[1].toLowerCase() : null;

    // Size: the mirrors-adjacent size cell looks like <a href="/file.php?...">10 MB</a>
    const sizeMatch = row.match(/>([\d.]+)\s*(KB|MB|GB)<\/a>/i);
    let sizeBytes = null;
    if (sizeMatch) {
      const n = parseFloat(sizeMatch[1]);
      const unit = sizeMatch[2].toUpperCase();
      const mult = unit === 'GB' ? 1e9 : unit === 'MB' ? 1e6 : 1e3;
      sizeBytes = Math.round(n * mult);
    }

    seen.add(id);
    results.push({ editionId: id, title, format, sizeBytes });
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

async function search(query, { format } = {}) {
  const url = `${BASE}/index.php?req=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`Libgen search failed: ${res.status}`);
  const html = await res.text();
  let editions = extractEditions(html);
  if (format) {
    editions = editions.filter((e) => e.format === format.toLowerCase());
  }
  return editions.map((e) => ({
    candidateId: `libgen:${e.editionId}`,
    editionId: e.editionId,
    title: e.title,
    size: e.sizeBytes,
    format: e.format,
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
