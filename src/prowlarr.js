'use strict';
// Prowlarr client: search releases in the Ebook/Audiobook categories (7000-range)
// and fetch NZB bytes server-side (never expose Prowlarr URLs/API key to clients).

const EBOOK_CATS = '7020'; // Books/EBook
const AUDIOBOOK_CATS = '3030'; // Audio/Audiobook

function config() {
  const base = process.env.PROWLARR_URL || 'http://10.21.0.1:9696';
  const apiKey = process.env.PROWLARR_API_KEY;
  if (!apiKey) throw new Error('PROWLARR_API_KEY not configured');
  return { base, apiKey };
}

async function search(query, { kind = 'ebook' } = {}) {
  const { base, apiKey } = config();
  const cats = kind === 'audiobook' ? AUDIOBOOK_CATS : EBOOK_CATS;
  const url = `${base}/api/v1/search?query=${encodeURIComponent(query)}&type=search&categories=${cats}`;
  const res = await fetch(url, { headers: { 'X-Api-Key': apiKey } });
  if (!res.ok) throw new Error(`Prowlarr search failed: ${res.status}`);
  const results = await res.json();
  return results.map((r, i) => ({
    candidateId: `${r.indexerId}:${i}:${Buffer.from(r.guid || r.downloadUrl || '').toString('base64').slice(0, 40)}`,
    title: r.title,
    size: r.size,
    indexer: r.indexer,
    protocol: r.protocol,
    seeders: r.seeders ?? null,
    publishDate: r.publishDate,
    _downloadUrl: r.downloadUrl || r.guid,
    _protocol: r.protocol,
  }));
}

// Cache raw candidates server-side so the client never sees real download URLs.
const candidateCache = new Map();
function cacheCandidates(list) {
  for (const c of list) candidateCache.set(c.candidateId, c);
  // Keep the cache bounded.
  if (candidateCache.size > 2000) {
    const oldestKeys = [...candidateCache.keys()].slice(0, candidateCache.size - 2000);
    for (const k of oldestKeys) candidateCache.delete(k);
  }
}

function getCandidate(candidateId) {
  return candidateCache.get(candidateId) || null;
}

async function fetchNzbBytes(downloadUrl) {
  const { base, apiKey } = config();
  if (!downloadUrl.startsWith(base)) {
    throw new Error('Refusing to fetch NZB from a non-Prowlarr origin');
  }
  const res = await fetch(downloadUrl, {
    headers: { 'X-Api-Key': apiKey },
    redirect: 'follow', // usenet indexers legitimately 302 to their own file host
  });
  if (!res.ok) throw new Error(`Prowlarr NZB fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

module.exports = { search, cacheCandidates, getCandidate, fetchNzbBytes };
