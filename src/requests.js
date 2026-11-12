'use strict';
// JSON-file request persistence (mirrors SongSeerr's approach).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'requests.json');

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]');
}

function all() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}

function save(list) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function create(entry) {
  const list = all();
  const id = crypto.randomUUID();
  const record = {
    id,
    status: 'pending',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...entry,
  };
  list.push(record);
  save(list);
  return record;
}

function update(id, patch) {
  const list = all();
  const idx = list.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  save(list);
  return list[idx];
}

function get(id) {
  return all().find((r) => r.id === id) || null;
}

module.exports = { all, create, update, get };
