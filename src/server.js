'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const openlibrary = require('./openlibrary');
const prowlarr = require('./prowlarr');
const sabnzbd = require('./sabnzbd');
const torbox = require('./torbox');
const libgen = require('./libgen');
const requests = require('./requests');
const importer = require('./importer');
const opds = require('./opds');

const libgenCandidates = new Map();
function cacheLibgenCandidates(list) {
  for (const c of list) libgenCandidates.set(c.candidateId, c);
}

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function handleApi(req, res, parsed) {
  const { pathname, query } = parsed;

  if (pathname === '/api/search' && req.method === 'GET') {
    const q = query.q || '';
    const language = (query.language || '').trim();
    if (!q.trim()) return sendJson(res, 400, { error: 'missing q' });
    const results = await openlibrary.searchBooks(q, { language });
    return sendJson(res, 200, {
      results: results.map((r) => ({ ...r, cover: openlibrary.coverUrl(r.coverId, 'S') })),
    });
  }

  if (pathname === '/api/search/authors' && req.method === 'GET') {
    const q = query.q || '';
    if (!q.trim()) return sendJson(res, 400, { error: 'missing q' });
    const results = await openlibrary.searchAuthors(q);
    return sendJson(res, 200, { results });
  }

  const authorWorksMatch = pathname.match(/^\/api\/author\/(.+)\/works$/);
  if (authorWorksMatch && req.method === 'GET') {
    const works = await openlibrary.authorWorks(authorWorksMatch[1]);
    return sendJson(res, 200, {
      results: works.map((w) => ({ ...w, cover: openlibrary.coverUrl(w.coverId) })),
    });
  }

  if (pathname === '/api/releases' && req.method === 'GET') {
    const q = query.q || '';
    const kind = query.kind === 'audiobook' ? 'audiobook' : 'ebook';
    if (!q.trim()) return sendJson(res, 400, { error: 'missing q' });

    const [prowlarrResults, libgenResults] = await Promise.all([
      prowlarr.search(q, { kind }).catch((err) => {
        console.error('prowlarr search failed', err);
        return [];
      }),
      kind === 'ebook'
        ? libgen.search(q).catch((err) => {
            console.error('libgen search failed', err);
            return [];
          })
        : Promise.resolve([]),
    ]);

    let results = [...libgenResults, ...prowlarrResults];
    let fallback = false;
    // Translated titles (common for non-English originals) often don't
    // match on their native-language title at all — if the full query came
    // up empty and an author was supplied, retry with just the author name
    // so the user can still find/pick the right book manually.
    if (!results.length && query.author) {
      const [pFallback, lFallback] = await Promise.all([
        prowlarr.search(query.author, { kind }).catch(() => []),
        kind === 'ebook' ? libgen.search(query.author).catch(() => []) : Promise.resolve([]),
      ]);
      results = [...lFallback, ...pFallback];
      fallback = true;
    }
    prowlarr.cacheCandidates(prowlarrResults);
    cacheLibgenCandidates(results.filter((r) => r.indexer === 'Libgen'));
    return sendJson(res, 200, {
      fallback,
      results: results.map(({ _downloadUrl, _protocol, ...rest }) => rest),
    });
  }

  if (pathname === '/api/requests' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const { candidateId, title, authors, kind } = body;
    if (!candidateId) return sendJson(res, 400, { error: 'missing candidateId' });
    const candidate = candidateId.startsWith('libgen:')
      ? libgenCandidates.get(candidateId)
      : prowlarr.getCandidate(candidateId);
    if (!candidate) return sendJson(res, 404, { error: 'candidate expired, search again' });

    const record = requests.create({
      title,
      authors,
      kind: kind === 'audiobook' ? 'audiobook' : 'ebook',
      indexer: candidate.indexer,
      protocol: candidate.protocol,
      releaseTitle: candidate.title,
    });

    submitCandidate(record, candidate).catch((err) => {
      requests.update(record.id, { status: 'failed', error: String(err.message || err) });
    });

    return sendJson(res, 201, record);
  }

  if (pathname === '/api/requests' && req.method === 'GET') {
    return sendJson(res, 200, { results: requests.all().reverse() });
  }

  const reqMatch = pathname.match(/^\/api\/requests\/([a-f0-9-]+)$/);
  if (reqMatch && req.method === 'GET') {
    const record = requests.get(reqMatch[1]);
    if (!record) return sendJson(res, 404, { error: 'not found' });
    return sendJson(res, 200, record);
  }

  sendJson(res, 404, { error: 'not found' });
}

async function submitCandidate(record, candidate) {
  if (candidate.protocol === 'direct') {
    requests.update(record.id, { status: 'downloading', backend: 'libgen' });
    const downloadUrl = await libgen.resolveDownloadUrl(candidate.editionId);
    const r = await fetch(downloadUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (BookSeer/0.1)' } });
    if (!r.ok) throw new Error(`Libgen download failed: ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    const cd = r.headers.get('content-disposition') || '';
    const nameMatch = cd.match(/filename="?([^";]+)"?/);
    const ext = nameMatch ? path.extname(nameMatch[1]) : '.epub';
    const destStaging = path.join('/tmp', `bookseer-${record.id}${ext}`);
    fs.writeFileSync(destStaging, buf);
    const finalPath = importer.importCompletedPathFromFile(destStaging, record);
    fs.unlinkSync(destStaging);
    requests.update(record.id, { status: 'completed', importedPath: finalPath });
  } else if (candidate.protocol === 'usenet') {
    const nzbBytes = await prowlarr.fetchNzbBytes(candidate._downloadUrl);
    const nzoId = await sabnzbd.addFile(nzbBytes, `${record.title || 'book'}.nzb`, 'books');
    requests.update(record.id, { status: 'downloading', backend: 'sabnzbd', jobId: nzoId });
  } else {
    const torrentId = await torbox.createFromMagnetOrUrl(candidate._downloadUrl);
    requests.update(record.id, { status: 'downloading', backend: 'torbox', jobId: torrentId });
    const data = await torbox.waitReady(torrentId);
    const files = data.files || [];
    if (!files.length) throw new Error('TorBox returned no files');
    const best = files.reduce((a, b) => (b.size > a.size ? b : a));
    const dl = await torbox.requestDownloadLink(torrentId, best.id);
    const destStaging = path.join('/tmp', `bookseer-${record.id}${path.extname(best.short_name || best.name || '')}`);
    const r = await fetch(dl);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(destStaging, buf);
    const finalPath = importer.importCompletedPathFromFile
      ? importer.importCompletedPathFromFile(destStaging, record)
      : null;
    fs.unlinkSync(destStaging);
    requests.update(record.id, { status: 'completed', importedPath: finalPath });
  }
}

const MONITOR_INTERVAL_MS = 15000;
async function monitorSabnzbd() {
  try {
    const pending = requests.all().filter((r) => r.status === 'downloading' && r.backend === 'sabnzbd');
    if (!pending.length) return;
    const hist = await sabnzbd.history(80);
    const slots = (hist.history && hist.history.slots) || [];
    for (const r of pending) {
      const slot = slots.find((s) => s.nzo_id === r.jobId);
      if (!slot) continue;
      if (slot.status === 'Completed') {
        try {
          const finalPath = importer.importCompletedPath(slot.storage, r);
          requests.update(r.id, { status: 'completed', importedPath: finalPath });
        } catch (err) {
          requests.update(r.id, { status: 'failed', error: String(err.message || err) });
        }
      } else if (slot.status === 'Failed') {
        requests.update(r.id, { status: 'failed', error: slot.fail_message || 'SABnzbd reported failure' });
      }
    }
  } catch (err) {
    console.error('monitor error', err);
  }
}
setInterval(monitorSabnzbd, MONITOR_INTERVAL_MS);

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  try {
    if (parsed.pathname.startsWith('/api/')) {
      return await handleApi(req, res, parsed);
    }

    // --- OPDS catalog (for CrossPoint, KOReader, Calibre, etc.) ---
    const base = `http://${req.headers.host}`;
    const sendOpds = (xml) => {
      res.writeHead(200, { 'Content-Type': 'application/atom+xml; charset=utf-8' });
      res.end(xml);
    };
    if (parsed.pathname === '/opds' && req.method === 'GET') {
      return sendOpds(opds.rootFeed(base));
    }
    if (parsed.pathname === '/opds/all' && req.method === 'GET') {
      return sendOpds(opds.allBooksFeed(base));
    }
    if (parsed.pathname === '/opds/authors' && req.method === 'GET') {
      return sendOpds(opds.authorsFeed(base));
    }
    const authorMatch = parsed.pathname.match(/^\/opds\/author\/([^/]+)$/);
    if (authorMatch && req.method === 'GET') {
      return sendOpds(opds.authorFeed(base, decodeURIComponent(authorMatch[1])));
    }
    const fileMatch = parsed.pathname.match(/^\/opds\/file\/(.+)$/);
    if (fileMatch && req.method === 'GET') {
      try {
        const parts = fileMatch[1].split('/').map(decodeURIComponent);
        const { fullPath, mime } = opds.resolveFile(parts);
        res.writeHead(200, { 'Content-Type': mime });
        return fs.createReadStream(fullPath).pipe(res);
      } catch (err) {
        return sendJson(res, 404, { error: 'not found' });
      }
    }

    // static file serving
    let filePath = path.join(PUBLIC_DIR, parsed.pathname === '/' ? 'index.html' : parsed.pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'forbidden' });
    if (!fs.existsSync(filePath)) filePath = path.join(PUBLIC_DIR, 'index.html');
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, () => console.log(`BookSeer listening on :${PORT}`));
