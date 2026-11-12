'use strict';
// TorBox client: for torrent-protocol candidates (reuses the same proven
// flow as torbox-blackhole-watcher.py / torbox-quickadd.py).

const fs = require('fs');

function apiKey() {
  const file = process.env.TORBOX_API_KEY_FILE || '/opt/data/secrets/torbox-api-key';
  return fs.readFileSync(file, 'utf8').trim();
}

const BASE = 'https://api.torbox.app/v1/api';

async function createFromMagnetOrUrl(value) {
  const key = apiKey();
  let res;
  if (value.startsWith('magnet:')) {
    const form = new URLSearchParams({ magnet: value, seed: '1', allow_zip: 'false' });
    res = await fetch(`${BASE}/torrents/createtorrent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } else {
    const tr = await fetch(value);
    if (!tr.ok) throw new Error(`Failed fetching .torrent: ${tr.status}`);
    const bytes = Buffer.from(await tr.arrayBuffer());
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'application/x-bittorrent' }), 'release.torrent');
    form.append('seed', '1');
    form.append('allow_zip', 'false');
    res = await fetch(`${BASE}/torrents/createtorrent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  }
  const data = await res.json();
  if (!data.success && !(data.detail || '').toLowerCase().includes('already')) {
    throw new Error(`TorBox createtorrent failed: ${JSON.stringify(data)}`);
  }
  return data.data.torrent_id;
}

async function waitReady(torrentId, { pollMs = 5000, timeoutMs = 20 * 60 * 1000 } = {}) {
  const key = apiKey();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/torrents/mylist?id=${torrentId}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    const data = await res.json();
    const d = data.data || {};
    if (d.download_finished || d.download_present) return d;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error('TorBox torrent not ready in time');
}

async function requestDownloadLink(torrentId, fileId) {
  const key = apiKey();
  const res = await fetch(
    `${BASE}/torrents/requestdl?token=${key}&torrent_id=${torrentId}&file_id=${fileId}`
  );
  const data = await res.json();
  if (!data.success) throw new Error(`TorBox requestdl failed: ${JSON.stringify(data)}`);
  return data.data;
}

module.exports = { createFromMagnetOrUrl, waitReady, requestDownloadLink };
