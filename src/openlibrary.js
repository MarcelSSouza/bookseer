'use strict';
// Open Library client: search by title or by author (Node >=20 has global fetch).

const BASE = 'https://openlibrary.org';
const COVERS = 'https://covers.openlibrary.org';

async function searchBooks(query, { limit = 20, language = '' } = {}) {
  // Quoting the title restricts matches to that phrase appearing in the
  // title, instead of a loose keyword match against the whole index (which
  // surfaced lots of unrelated books sharing a common word).
  let q = `title:"${query.replace(/"/g, '')}"`;
  if (language) q += ` language:${language}`;
  const url = `${BASE}/search.json?q=${encodeURIComponent(q)}&limit=${limit}&fields=key,title,author_name,first_publish_year,cover_i,edition_key,isbn,language`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BookSeer/0.1 (self-hosted)' } });
  if (!res.ok) throw new Error(`Open Library search failed: ${res.status}`);
  const data = await res.json();
  let docs = data.docs || [];
  // Fall back to a looser match if the strict phrase search found nothing.
  if (!docs.length) {
    let fallbackQ = query;
    if (language) fallbackQ += ` language:${language}`;
    const fbUrl = `${BASE}/search.json?q=${encodeURIComponent(fallbackQ)}&limit=${limit}&fields=key,title,author_name,first_publish_year,cover_i,edition_key,isbn,language`;
    const fbRes = await fetch(fbUrl, { headers: { 'User-Agent': 'BookSeer/0.1 (self-hosted)' } });
    if (fbRes.ok) docs = (await fbRes.json()).docs || [];
  }
  // Rank exact (or near-exact) title matches first — "title:" phrase search
  // matches the phrase ANYWHERE in the title ("O processo civilizador" also
  // matches "o processo"), which buries the book actually being searched for.
  const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const target = norm(query);
  docs.sort((a, b) => {
    const score = (d) => {
      const t = norm(d.title);
      if (t === target) return 0;
      if (t.startsWith(target)) return 1;
      return 2 + Math.abs(t.length - target.length) / 100;
    };
    return score(a) - score(b);
  });
  return docs.map(normalizeDoc);
}

async function searchAuthors(query, { limit = 10 } = {}) {
  const url = `${BASE}/search/authors.json?q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BookSeer/0.1 (self-hosted)' } });
  if (!res.ok) throw new Error(`Open Library author search failed: ${res.status}`);
  const data = await res.json();
  return (data.docs || []).map((d) => ({
    key: d.key,
    name: d.name,
    workCount: d.work_count,
    topWork: d.top_work,
  }));
}

async function authorWorks(authorKey, { limit = 50 } = {}) {
  const url = `${BASE}/authors/${authorKey}/works.json?limit=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BookSeer/0.1 (self-hosted)' } });
  if (!res.ok) throw new Error(`Open Library author works failed: ${res.status}`);
  const data = await res.json();
  return (data.entries || []).map((w) => ({
    key: w.key,
    title: w.title,
    firstPublishYear: w.first_publish_date || null,
    coverId: (w.covers && w.covers[0]) || null,
  }));
}

function normalizeDoc(d) {
  return {
    key: d.key,
    title: d.title,
    authors: d.author_name || [],
    year: d.first_publish_year || null,
    coverId: d.cover_i || null,
    isbn: (d.isbn && d.isbn[0]) || null,
    language: (d.language && d.language[0]) || null,
  };
}

function coverUrl(coverId, size = 'M') {
  if (!coverId) return null;
  return `${COVERS}/b/id/${coverId}-${size}.jpg`;
}

module.exports = { searchBooks, searchAuthors, authorWorks, coverUrl };
