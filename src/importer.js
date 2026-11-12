'use strict';
// Import a completed download into the final BookSeer library, safely.

const fs = require('fs');
const path = require('path');

const LIBRARY_ROOT = process.env.LIBRARY_DIR || '/downloads/books';
// SABnzbd reports storage paths as ITS OWN container sees them (e.g.
// "/downloads/..."); SAB_CONTAINER_ROOT/SAB_LOCAL_ROOT translate that into
// whatever path this process actually sees the same shared volume at.
const SAB_CONTAINER_ROOT = process.env.SABNZBD_CONTAINER_DOWNLOADS_ROOT || '/downloads';
const SAB_LOCAL_ROOT = process.env.SABNZBD_LOCAL_DOWNLOADS_ROOT || '/downloads';

function translateSabPath(sabPath) {
  if (sabPath.startsWith(SAB_CONTAINER_ROOT)) {
    return SAB_LOCAL_ROOT + sabPath.slice(SAB_CONTAINER_ROOT.length);
  }
  return sabPath;
}

const EBOOK_EXT = new Set(['.epub', '.mobi', '.azw3', '.azw', '.pdf', '.cbz', '.cbr', '.fb2']);
const AUDIOBOOK_EXT = new Set(['.m4b', '.mp3', '.m4a', '.flac']);

function safeJoin(root, ...parts) {
  const resolvedRoot = fs.realpathSync(root);
  const target = path.join(resolvedRoot, ...parts);
  const resolved = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path traversal rejected');
  }
  return resolved;
}

function sanitizeName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function findBestFile(dir, wantAudiobook) {
  const exts = wantAudiobook ? AUDIOBOOK_EXT : EBOOK_EXT;
  let best = null;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink()) continue; // never follow symlinks from untrusted downloads
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(cur)) stack.push(path.join(cur, entry));
      continue;
    }
    if (!st.isFile()) continue;
    const ext = path.extname(cur).toLowerCase();
    if (exts.has(ext) && (!best || st.size > best.size)) {
      best = { file: cur, size: st.size, ext };
    }
  }
  return best;
}

function importCompletedPath(sabStoragePath, meta) {
  const localPath = translateSabPath(sabStoragePath);
  const resolvedSource = fs.realpathSync(localPath);
  const resolvedLocalRoot = fs.realpathSync(SAB_LOCAL_ROOT);
  const rel = path.relative(resolvedLocalRoot, resolvedSource);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Completed path is outside the configured downloads root');
  }

  const wantAudiobook = meta.kind === 'audiobook';
  // SABnzbd's "storage" can point directly at the final file (single-file
  // releases) or at a job folder containing it (multi-file releases).
  const sourceRoot = fs.statSync(resolvedSource).isDirectory()
    ? resolvedSource
    : path.dirname(resolvedSource);
  const best = findBestFile(sourceRoot, wantAudiobook);
  if (!best) throw new Error('No matching ebook/audiobook file found in completed download');

  const authorDir = sanitizeName((meta.authors && meta.authors[0]) || 'Unknown Author');
  const titleName = sanitizeName(meta.title || path.basename(best.file, best.ext));
  const destDir = safeJoin(LIBRARY_ROOT, authorDir);
  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, `${titleName}${best.ext}`);

  fs.copyFileSync(best.file, destFile);
  return destFile;
}

function importCompletedPathFromFile(filePath, meta) {
  const ext = path.extname(filePath).toLowerCase();
  const wantAudiobook = meta.kind === 'audiobook';
  const validExts = wantAudiobook ? AUDIOBOOK_EXT : EBOOK_EXT;
  if (!validExts.has(ext)) {
    throw new Error(`Downloaded file has unexpected extension for ${meta.kind}: ${ext}`);
  }
  const authorDir = sanitizeName((meta.authors && meta.authors[0]) || 'Unknown Author');
  const titleName = sanitizeName(meta.title || path.basename(filePath, ext));
  const destDir = safeJoin(LIBRARY_ROOT, authorDir);
  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, `${titleName}${ext}`);
  fs.copyFileSync(filePath, destFile);
  return destFile;
}

module.exports = { importCompletedPath, importCompletedPathFromFile, safeJoin, sanitizeName };
