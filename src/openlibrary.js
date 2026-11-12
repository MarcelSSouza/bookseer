'use strict';
// Open Library client: search by title or by author (Node >=20 has global fetch).

const BASE = 'https://openlibrary.org';
const COVERS = 'https://covers.openlibrary.org';

async function searchBooks(query, { limit = 20 } = {}) {
  const url = `${BASE}/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=key,title,author_name,first_publish_year,cover_i,edition_key,isbn`;
  const res = await fetch(url, { headers: { 'User-Agent': 'BookSeer/0.1 (self-hosted)' } });
  if (!res.ok) throw new Error(`Open Library search failed: ${res.status}`);
  const data = await res.json();
  return (data.docs || []).map(normalizeDoc);
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
  };
}

function coverUrl(coverId, size = 'M') {
  if (!coverId) return null;
  return `${COVERS}/b/id/${coverId}-${size}.jpg`;
}

module.exports = { searchBooks, searchAuthors, authorWorks, coverUrl };
