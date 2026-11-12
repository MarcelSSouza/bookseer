'use strict';

const state = { lastSelected: null };

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('search-view').classList.toggle('hidden', tab !== 'search');
    document.getElementById('requests-view').classList.toggle('hidden', tab !== 'requests');
    if (tab === 'requests') loadRequests();
  });
});

document.getElementById('search-btn').addEventListener('click', doSearch);
document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

async function doSearch() {
  const type = document.getElementById('search-type').value;
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const grid = document.getElementById('results');
  grid.innerHTML = '<p>Buscando...</p>';

  if (type === 'author') {
    const res = await fetch(`/api/search/authors?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    grid.innerHTML = '';
    if (!data.results || !data.results.length) {
      grid.innerHTML = '<p>Nenhum autor encontrado.</p>';
      return;
    }
    data.results.forEach((a) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="title">${escapeHtml(a.name)}</div><div class="author">${a.workCount} obras</div>`;
      card.addEventListener('click', () => loadAuthorWorks(a));
      grid.appendChild(card);
    });
  } else {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    renderBookGrid(data.results || []);
  }
}

async function loadAuthorWorks(author) {
  const grid = document.getElementById('results');
  grid.innerHTML = '<p>Carregando obras...</p>';
  const key = author.key.replace('/authors/', '');
  const res = await fetch(`/api/author/${key}/works`);
  const data = await res.json();
  renderBookGrid(
    (data.results || []).map((w) => ({ title: w.title, authors: [author.name], cover: w.cover, year: w.firstPublishYear }))
  );
}

function renderBookGrid(books) {
  const grid = document.getElementById('results');
  grid.innerHTML = '';
  if (!books.length) {
    grid.innerHTML = '<p>Nenhum resultado.</p>';
    return;
  }
  books.forEach((b) => {
    const card = document.createElement('div');
    card.className = 'card';
    const cover = b.cover
      ? `<img src="${b.cover}" alt="" />`
      : `<div style="aspect-ratio:2/3;background:#333;border-radius:6px;"></div>`;
    card.innerHTML = `${cover}<div class="title">${escapeHtml(b.title)}</div><div class="author">${escapeHtml((b.authors || []).join(', '))}${b.year ? ' · ' + b.year : ''}</div>`;
    card.addEventListener('click', () => openModal(b));
    grid.appendChild(card);
  });
}

function openModal(book) {
  state.lastSelected = book;
  document.getElementById('modal-title').textContent = book.title;
  document.getElementById('releases').innerHTML = '';
  document.getElementById('modal').classList.remove('hidden');
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal').classList.add('hidden');
});

document.getElementById('modal-search-releases').addEventListener('click', async () => {
  const book = state.lastSelected;
  const kind = document.querySelector('input[name="kind"]:checked').value;
  const q = `${book.title} ${(book.authors || [])[0] || ''}`.trim();
  const releasesDiv = document.getElementById('releases');
  releasesDiv.innerHTML = '<p>Buscando versões...</p>';
  const res = await fetch(`/api/releases?q=${encodeURIComponent(q)}&kind=${kind}`);
  const data = await res.json();
  releasesDiv.innerHTML = '';
  if (!data.results || !data.results.length) {
    releasesDiv.innerHTML = '<p>Nenhuma versão encontrada.</p>';
    return;
  }
  data.results.slice(0, 20).forEach((r) => {
    const row = document.createElement('div');
    row.className = 'release-item';
    const sizeMb = (r.size / 1e6).toFixed(1);
    row.innerHTML = `<div><div>${escapeHtml(r.title)}</div><div class="author">${r.indexer} · ${sizeMb}MB · ${r.protocol}</div></div>`;
    const btn = document.createElement('button');
    btn.textContent = 'Pedir';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Enviando...';
      const resp = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          candidateId: r.candidateId,
          title: book.title,
          authors: book.authors,
          kind,
        }),
      });
      if (resp.ok) {
        btn.textContent = 'Pedido enviado ✓';
        setTimeout(() => document.getElementById('modal').classList.add('hidden'), 800);
      } else {
        btn.textContent = 'Erro';
        btn.disabled = false;
      }
    });
    row.appendChild(btn);
    releasesDiv.appendChild(row);
  });
});

async function loadRequests() {
  const list = document.getElementById('requests-list');
  list.innerHTML = '<p>Carregando...</p>';
  const res = await fetch('/api/requests');
  const data = await res.json();
  list.innerHTML = '';
  if (!data.results || !data.results.length) {
    list.innerHTML = '<p>Nenhum pedido ainda.</p>';
    return;
  }
  data.results.forEach((r) => {
    const item = document.createElement('div');
    item.className = 'req-item';
    item.innerHTML = `
      <div>
        <div><strong>${escapeHtml(r.title || r.releaseTitle || '')}</strong></div>
        <div class="author">${escapeHtml((r.authors || []).join(', '))} · ${r.kind}</div>
      </div>
      <span class="status ${r.status}">${r.status}</span>
    `;
    list.appendChild(item);
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
