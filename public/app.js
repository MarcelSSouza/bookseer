'use strict';

const state = { lastSelected: null, searchType: 'title', knownStatuses: {} };

// --- Toasts ---------------------------------------------------------------
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const emoji = type === 'success' ? '✅' : type === 'error' ? '⚠️' : '📚';
  el.innerHTML = `<span class="emoji">${emoji}</span><span>${escapeHtml(message)}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3100);
}

// --- Bottom nav -------------------------------------------------------------
document.querySelectorAll('.navbtn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.navbtn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById('search-view').classList.toggle('hidden', tab !== 'search');
    document.getElementById('requests-view').classList.toggle('hidden', tab !== 'requests');
    if (tab === 'requests') loadRequests();
  });
});

// --- Search type chips -------------------------------------------------------
document.querySelectorAll('#type-chips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('#type-chips .chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.searchType = chip.dataset.type;
  });
});

document.getElementById('search-btn').addEventListener('click', doSearch);
document.getElementById('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

async function doSearch() {
  const type = state.searchType;
  const q = document.getElementById('search-input').value.trim();
  const language = document.getElementById('search-lang').value;
  if (!q) return;
  const grid = document.getElementById('results');
  grid.innerHTML = '<div class="spinner"></div>';

  try {
    if (type === 'author') {
      const res = await fetch(`/api/search/authors?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      grid.innerHTML = '';
      if (!data.results || !data.results.length) {
        grid.innerHTML = emptyState('🔍', 'Nenhum autor encontrado.');
        return;
      }
      data.results.forEach((a) => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<div class="cover-wrap cover-placeholder">👤</div><div class="title">${escapeHtml(a.name)}</div><div class="author">${a.workCount} obras</div>`;
        card.addEventListener('click', () => loadAuthorWorks(a));
        grid.appendChild(card);
      });
    } else {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&language=${encodeURIComponent(language)}`);
      const data = await res.json();
      renderBookGrid(data.results || []);
    }
  } catch (err) {
    grid.innerHTML = '';
    toast('Erro ao buscar. Tente de novo.', 'error');
  }
}

async function loadAuthorWorks(author) {
  const grid = document.getElementById('results');
  grid.innerHTML = '<div class="spinner"></div>';
  const key = author.key.replace('/authors/', '');
  const res = await fetch(`/api/author/${key}/works`);
  const data = await res.json();
  renderBookGrid(
    (data.results || []).map((w) => ({ title: w.title, authors: [author.name], cover: w.cover, year: w.firstPublishYear }))
  );
}

function emptyState(emoji, text) {
  return `<div class="empty-state"><span class="big-emoji">${emoji}</span>${escapeHtml(text)}</div>`;
}

function renderBookGrid(books) {
  const grid = document.getElementById('results');
  grid.innerHTML = '';
  if (!books.length) {
    grid.innerHTML = emptyState('📭', 'Nenhum resultado.');
    return;
  }
  books.forEach((b, i) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.animationDelay = `${Math.min(i, 12) * 0.03}s`;
    const cover = b.cover
      ? `<img src="${b.cover}" alt="" loading="lazy" decoding="async" class="cover" onload="this.classList.add('loaded')" onerror="this.parentElement.innerHTML='📖'" />`
      : `📖`;
    card.innerHTML = `<div class="cover-wrap">${cover}</div><div class="title">${escapeHtml(b.title)}</div><div class="author">${escapeHtml((b.authors || []).join(', '))}${b.year ? ' · ' + b.year : ''}</div>`;
    card.addEventListener('click', () => openModal(b));
    grid.appendChild(card);
  });
}

function openModal(book) {
  state.lastSelected = book;
  document.getElementById('modal-title').textContent = book.title;
  document.getElementById('modal-author').textContent = (book.authors || []).join(', ');
  document.getElementById('modal-cover').innerHTML = book.cover
    ? `<img src="${book.cover}" alt="" />`
    : '📖';
  document.getElementById('releases').innerHTML = '';
  document.getElementById('modal').classList.remove('hidden');
}

document.getElementById('modal-close').addEventListener('click', () => {
  document.getElementById('modal').classList.add('hidden');
});
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') document.getElementById('modal').classList.add('hidden');
});

document.getElementById('modal-search-releases').addEventListener('click', async (e) => {
  const trigger = e.currentTarget;
  const book = state.lastSelected;
  const kind = document.querySelector('input[name="kind"]:checked').value;
  const format = document.getElementById('format-filter').value;
  const author = (book.authors || [])[0] || '';
  const q = `${book.title} ${author}`.trim();
  const releasesDiv = document.getElementById('releases');
  trigger.disabled = true;
  releasesDiv.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch(`/api/releases?q=${encodeURIComponent(q)}&kind=${kind}&author=${encodeURIComponent(author)}&format=${encodeURIComponent(format)}`);
    const data = await res.json();
    releasesDiv.innerHTML = '';
    trigger.disabled = false;
    if (!data.results || !data.results.length) {
      releasesDiv.innerHTML = emptyState('😕', 'Nenhuma versão encontrada, nem pelo autor.');
      return;
    }
    if (data.fallback) {
      const note = document.createElement('p');
      note.className = 'author';
      note.textContent = `Não achamos pelo título exato (comum quando o livro é catalogado em outro idioma) — aqui estão versões de ${author}, escolha manualmente:`;
      releasesDiv.appendChild(note);
    }
    data.results.slice(0, 20).forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'release-item';
      row.style.animationDelay = `${Math.min(i, 12) * 0.03}s`;
      const sizeMb = r.size ? (r.size / 1e6).toFixed(1) + 'MB' : '';
      const fmtTag = r.format ? r.format.toUpperCase() + ' · ' : '';
      row.innerHTML = `<div class="rinfo"><div class="rtitle">${escapeHtml(r.title)}</div><div class="rmeta">${fmtTag}${escapeHtml(r.indexer)}${sizeMb ? ' · ' + sizeMb : ''} · ${escapeHtml(r.protocol)}</div></div>`;
      const btn = document.createElement('button');
      btn.textContent = 'Pedir';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Enviando...';
        try {
          const resp = await fetch('/api/requests', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidateId: r.candidateId, title: book.title, authors: book.authors, kind }),
          });
          if (resp.ok) {
            btn.textContent = '✓';
            toast(`Pedido de "${book.title}" enviado!`, 'success');
            setTimeout(() => document.getElementById('modal').classList.add('hidden'), 700);
          } else {
            btn.textContent = 'Erro';
            btn.disabled = false;
            toast('Não foi possível enviar o pedido.', 'error');
          }
        } catch (err) {
          btn.textContent = 'Erro';
          btn.disabled = false;
          toast('Falha de rede ao enviar o pedido.', 'error');
        }
      });
      row.appendChild(btn);
      releasesDiv.appendChild(row);
    });
  } catch (err) {
    releasesDiv.innerHTML = '';
    trigger.disabled = false;
    toast('Erro ao buscar versões.', 'error');
  }
});

async function loadRequests() {
  const list = document.getElementById('requests-list');
  list.innerHTML = '<div class="spinner"></div>';
  try {
    const res = await fetch('/api/requests');
    const data = await res.json();
    renderRequests(data.results || []);
  } catch (err) {
    list.innerHTML = '';
    toast('Erro ao carregar pedidos.', 'error');
  }
}

function renderRequests(results) {
  const list = document.getElementById('requests-list');
  list.innerHTML = '';
  if (!results.length) {
    list.innerHTML = emptyState('🗒️', 'Nenhum pedido ainda.');
    updateNavBadge(0);
    return;
  }
  const statusLabel = { pending: 'na fila', downloading: 'baixando', completed: 'concluído', failed: 'falhou' };
  results.forEach((r, i) => {
    const item = document.createElement('div');
    item.className = 'req-item';
    item.style.animationDelay = `${Math.min(i, 12) * 0.03}s`;
    item.innerHTML = `
      <div class="rtext">
        <strong>${escapeHtml(r.title || r.releaseTitle || '')}</strong>
        <div class="author">${escapeHtml((r.authors || []).join(', '))} · ${r.kind === 'audiobook' ? '🎧' : '📖'}</div>
      </div>
      <span class="status ${r.status}">${statusLabel[r.status] || r.status}</span>
    `;
    list.appendChild(item);
  });
  const active = results.filter((r) => r.status === 'pending' || r.status === 'downloading').length;
  updateNavBadge(active);
}

function updateNavBadge(count) {
  const badge = document.getElementById('nav-badge');
  badge.textContent = count;
  badge.classList.toggle('hidden', count === 0);
}

// Poll requests in the background so status changes (e.g. completed) surface
// as a toast even if the user is on the search tab.
async function pollRequests() {
  try {
    const res = await fetch('/api/requests');
    const data = await res.json();
    const results = data.results || [];
    results.forEach((r) => {
      const prev = state.knownStatuses[r.id];
      if (prev && prev !== r.status) {
        if (r.status === 'completed') toast(`"${r.title || r.releaseTitle}" chegou na biblioteca! 🎉`, 'success');
        else if (r.status === 'failed') toast(`Falha ao baixar "${r.title || r.releaseTitle}".`, 'error');
      }
      state.knownStatuses[r.id] = r.status;
    });
    const active = results.filter((r) => r.status === 'pending' || r.status === 'downloading').length;
    updateNavBadge(active);
    if (!document.getElementById('requests-view').classList.contains('hidden')) {
      renderRequests(results);
    }
  } catch (err) {
    /* silent — background poll */
  }
}
pollRequests();
setInterval(pollRequests, 8000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
