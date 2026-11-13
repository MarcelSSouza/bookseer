'use strict';
// SABnzbd client: submit NZB bytes, poll queue/history.

function config() {
  const base = process.env.SABNZBD_URL || 'http://localhost:9876';
  const apiKey = process.env.SABNZBD_API_KEY;
  if (!apiKey) throw new Error('SABNZBD_API_KEY not configured');
  return { base, apiKey };
}

async function addFile(nzbBytes, filename, category = 'books') {
  const { base, apiKey } = config();
  const form = new FormData();
  form.append('mode', 'addfile');
  form.append('apikey', apiKey);
  form.append('cat', category);
  form.append('output', 'json');
  form.append('name', new Blob([nzbBytes], { type: 'application/x-nzb' }), filename);
  const res = await fetch(`${base}/api`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`SABnzbd addfile failed: ${res.status}`);
  const data = await res.json();
  if (!data.status) throw new Error(`SABnzbd rejected the release: ${JSON.stringify(data)}`);
  return data.nzo_ids ? data.nzo_ids[0] : null;
}

async function queue() {
  const { base, apiKey } = config();
  const res = await fetch(`${base}/api?mode=queue&apikey=${apiKey}&output=json`);
  if (!res.ok) throw new Error(`SABnzbd queue failed: ${res.status}`);
  return res.json();
}

async function history(limit = 50) {
  const { base, apiKey } = config();
  const res = await fetch(`${base}/api?mode=history&limit=${limit}&apikey=${apiKey}&output=json`);
  if (!res.ok) throw new Error(`SABnzbd history failed: ${res.status}`);
  return res.json();
}

module.exports = { addFile, queue, history };
