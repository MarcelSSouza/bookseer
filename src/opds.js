'use strict';
// Minimal OPDS 1.2 (Atom) catalog over the BookSeer library, so e-readers
// (CrossPoint on Xteink, KOReader, Calibre, etc.) can browse + download
// already-imported books directly, without going through the web UI.

const fs = require('fs');
const path = require('path');

const LIBRARY_ROOT = process.env.LIBRARY_DIR || '/downloads/books';

const MIME = {
  '.epub': 'application/epub+zip',
  '.mobi': 'application/x-mobipocket-ebook',
  '.azw3': 'application/vnd.amazon.ebook',
  '.azw': 'application/vnd.amazon.ebook',
  '.pdf': 'application/pdf',
  '.cbz': 'application/x-cbz',
  '.cbr': 'application/x-cbr',
  '.fb2': 'application/x-fictionbook+xml',
  '.m4b': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

function escapeXml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[c]));
}

function listAuthors() {
  if (!fs.existsSync(LIBRARY_ROOT)) return [];
  return fs.readdirSync(LIBRARY_ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

function listBooksForAuthor(authorDir) {
  const dir = path.join(LIBRARY_ROOT, authorDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => {
      const ext = path.extname(e.name).toLowerCase();
      return {
        title: path.basename(e.name, ext),
        file: e.name,
        ext,
        mime: MIME[ext] || 'application/octet-stream',
        relPath: `${authorDir}/${e.name}`,
        mtime: fs.statSync(path.join(dir, e.name)).mtimeMs,
      };
    })
    .filter((b) => b.mime !== 'application/octet-stream')
    .sort((a, b) => a.title.localeCompare(b.title));
}

function listAllBooks() {
  const out = [];
  for (const author of listAuthors()) {
    for (const book of listBooksForAuthor(author)) {
      out.push({ ...book, author });
    }
  }
  return out;
}

function feedHeader(id, title, selfHref) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog" xmlns:dc="http://purl.org/dc/terms/">
  <id>${escapeXml(id)}</id>
  <title>${escapeXml(title)}</title>
  <updated>${new Date().toISOString()}</updated>
  <link rel="self" href="${escapeXml(selfHref)}" type="application/atom+xml;profile=opds-catalog"/>
  <link rel="start" href="/opds" type="application/atom+xml;profile=opds-catalog"/>
`;
}

function navEntry(title, href, content) {
  return `  <entry>
    <title>${escapeXml(title)}</title>
    <id>urn:bookseer:${escapeXml(href)}</id>
    <updated>${new Date().toISOString()}</updated>
    <content type="text">${escapeXml(content || '')}</content>
    <link rel="subsection" href="${escapeXml(href)}" type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
  </entry>
`;
}

function acquisitionEntry(book) {
  const downloadHref = `/opds/file/${book.relPath.split('/').map(encodeURIComponent).join('/')}`;
  return `  <entry>
    <title>${escapeXml(book.title)}</title>
    <id>urn:bookseer:${escapeXml(book.relPath)}</id>
    <author><name>${escapeXml(book.author)}</name></author>
    <updated>${new Date(book.mtime).toISOString()}</updated>
    <content type="text">${escapeXml(book.author)}</content>
    <link rel="http://opds-spec.org/acquisition" href="${downloadHref}" type="${book.mime}"/>
  </entry>
`;
}

function rootFeed() {
  let xml = feedHeader('urn:bookseer:root', 'BookSeer', '/opds');
  xml += navEntry('Todos os livros', '/opds/all', 'Todos os livros da biblioteca, por título');
  xml += navEntry('Por autor', '/opds/authors', 'Navegar por autor');
  xml += '</feed>\n';
  return xml;
}

function allBooksFeed() {
  let xml = feedHeader('urn:bookseer:all', 'Todos os livros', '/opds/all');
  for (const book of listAllBooks()) xml += acquisitionEntry(book);
  xml += '</feed>\n';
  return xml;
}

function authorsFeed() {
  let xml = feedHeader('urn:bookseer:authors', 'Por autor', '/opds/authors');
  for (const author of listAuthors()) {
    xml += navEntry(author, `/opds/author/${encodeURIComponent(author)}`, '');
  }
  xml += '</feed>\n';
  return xml;
}

function authorFeed(authorDir) {
  let xml = feedHeader(`urn:bookseer:author:${authorDir}`, authorDir, `/opds/author/${encodeURIComponent(authorDir)}`);
  for (const book of listBooksForAuthor(authorDir)) xml += acquisitionEntry({ ...book, author: authorDir });
  xml += '</feed>\n';
  return xml;
}

function resolveFile(relPathParts) {
  // relPathParts: array of decoded path segments, e.g. ['Jorge Amado', 'Gabriela.epub']
  const resolvedRoot = fs.realpathSync(LIBRARY_ROOT);
  const target = path.resolve(resolvedRoot, ...relPathParts);
  const rel = path.relative(resolvedRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path traversal rejected');
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    throw new Error('File not found');
  }
  const ext = path.extname(target).toLowerCase();
  return { fullPath: target, mime: MIME[ext] || 'application/octet-stream' };
}

module.exports = { rootFeed, allBooksFeed, authorsFeed, authorFeed, resolveFile };
