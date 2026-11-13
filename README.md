# 📚 BookSeer

A self-hosted, Seerr-style **request manager for ebooks and audiobooks**.
Search a title or author, pick a release, and BookSeer downloads it and drops
it straight into your library (Jellyfin, Calibre-Web, or any folder-based
reader) — no manual searching across shady sites, no manual file sorting.

Built as a free, open-source companion to the `*arr` stack (Radarr/Sonarr/
Prowlarr) for people who already self-host movies/TV and want the same
experience for books.

![status](https://img.shields.io/badge/status-active-brightgreen)
![license](https://img.shields.io/badge/license-GPL--3.0-blue)

## Features

- 🔍 **Search by title or author** via the free [Open Library](https://openlibrary.org) API (no key required)
- 🌐 **Language filter** + exact-title ranking (so searching a translated classic doesn't bury the real book under unrelated titles)
- 📦 **Multiple sources** for actual files:
  - [Libgen](https://libgen.li) — free, no account, excellent non-English coverage
  - [Prowlarr](https://prowlarr.com) — your existing Usenet/torrent indexers
- 🎯 **Filter releases by file format** — EPUB, PDF, MOBI, AZW3, TXT, ODT, FB2, CBZ/CBR, DOC/RTF
- ⬇️ **Automatic download + import** via SABnzbd (Usenet) or [TorBox](https://torbox.app) (torrents/magnets) — files land pre-sorted as `Library/Author Name/Title.ext`
- 📖 **Built-in OPDS catalog** — browse and download your library directly from an e-reader (CrossPoint on Xteink, KOReader, Calibre, etc.) without a PC
- 📱 Installable PWA, mobile-first UI, live status updates with toasts
- 🐳 Single Docker container, no database server required (flat JSON state file)

## Architecture

```
Browser / e-reader (OPDS)
        │
        ▼
   BookSeer (Node.js, single process)
        │
   ┌────┼─────────────┬──────────────┐
   ▼    ▼              ▼              ▼
Open Library   Prowlarr        Libgen        SABnzbd / TorBox
 (search)    (your indexers)  (free books)   (download the file)
                                                     │
                                                     ▼
                                          Library/Author/Title.ext
                                          (your Jellyfin/Calibre folder)
```

BookSeer itself never stores API keys or indexer credentials client-side —
everything server-to-server, the browser only ever talks to BookSeer.

## Requirements

- Docker (or Node.js ≥ 20 if running without Docker)
- [Prowlarr](https://prowlarr.com) with at least one indexer that covers book
  categories (`7000`-range for ebooks, `3030` for audiobooks) — **optional**,
  BookSeer still works with Libgen alone if you skip this
- **One of:**
  - [SABnzbd](https://sabnzbd.org) — for Usenet-protocol releases found via Prowlarr
  - [TorBox](https://torbox.app) — for torrent-protocol releases found via Prowlarr (paid service, has a free tier)
  - Neither — BookSeer still works using Libgen alone (`protocol: direct`, no download client needed)

None of the above are hard requirements individually; BookSeer degrades
gracefully and only needs the integration for the specific release type
you're trying to download.

## Quick Start (Docker Compose)

1. Copy `.env.example` to `.env` and fill in what you have:

```bash
cp .env.example .env
```

2. Point `LIBRARY_DIR`/the `/downloads` volume at wherever your media server
   (Jellyfin, Calibre-Web, etc.) expects books.

3. Run:

```bash
docker compose up -d
```

4. Open `http://<your-host>:3344`.

See `docker-compose.yml` in this repo for the full example.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | no | `3000` | Port BookSeer listens on inside the container |
| `LIBRARY_DIR` | no | `/downloads/books` | Where finished books are organized as `Author/Title.ext` |
| `PROWLARR_URL` | no¹ | `http://localhost:9696` | Base URL of your Prowlarr instance |
| `PROWLARR_API_KEY` | no¹ | — | Prowlarr → Settings → General → API Key |
| `PROWLARR_EBOOK_CATEGORIES` | no | `7020` | Prowlarr category id(s) for ebooks |
| `PROWLARR_AUDIOBOOK_CATEGORIES` | no | `3030` | Prowlarr category id(s) for audiobooks |
| `SABNZBD_URL` | no¹ | `http://localhost:9876` | Base URL of your SABnzbd instance |
| `SABNZBD_API_KEY` | no¹ | — | SABnzbd → Config → General → API Key |
| `SABNZBD_CATEGORY` | no | `books` | SABnzbd category new downloads are tagged with |
| `SABNZBD_CONTAINER_DOWNLOADS_ROOT` | no | `/downloads` | How **SABnzbd's own container** sees the shared downloads volume |
| `SABNZBD_LOCAL_DOWNLOADS_ROOT` | no | `/downloads` | How **BookSeer's container** sees the same shared volume (only differs if the mount paths genuinely differ between the two containers) |
| `TORBOX_API_KEY` | no¹ | — | TorBox API key (torbox.app → account settings) |
| `TORBOX_API_KEY_FILE` | no | — | Alternative to `TORBOX_API_KEY`: path to a file containing the key |
| `LIBGEN_BASE` | no | `https://libgen.li` | Libgen mirror to use (switch if this one is down/blocked) |
| `DATA_DIR` | no | `/data` | Where BookSeer stores its own request-history JSON file |

¹ Only required if you want that specific integration (Prowlarr search,
SABnzbd downloads, or TorBox downloads). BookSeer works with none of them
configured — you just lose that source/download path.

## Connecting an E-Reader (OPDS)

BookSeer exposes an [OPDS](https://en.wikipedia.org/wiki/Open_Publication_Distribution_System)
catalog of your already-downloaded library at `/opds`:

- `GET /opds` — root catalog (navigation)
- `GET /opds/all` — every book, flat list
- `GET /opds/authors` — browse by author
- `GET /opds/file/<path>` — the actual download link for a book

Add it as an OPDS server in your reader (CrossPoint, KOReader, Calibre, etc.):

```
http://<your-host>:3344/opds
```

No username/password needed by default.

**Important:** use the IP/hostname your e-reader can actually reach on your
LAN (e.g. `192.168.1.x`) — not `localhost` or a Docker-internal address,
which won't be reachable from another device.

## Jellyfin / Calibre-Web Integration

Point a Jellyfin "Books" library (or Calibre-Web's library folder) at the
same path mounted as `LIBRARY_DIR`/`/downloads/books`. New books appear
automatically after each successful BookSeer download — no extra scripting
needed.

## Development

```bash
npm install
PROWLARR_URL=http://localhost:9696 \
PROWLARR_API_KEY=xxx \
LIBRARY_DIR=./data/library \
npm start
```

## Known Limitations

- No PDF/MOBI conversion — files are imported as-is from the source release
- Libgen coverage/uptime varies by mirror; swap `LIBGEN_BASE` if needed
- No authentication on the web UI or OPDS endpoint — put it behind your own
  reverse proxy / VPN if exposing beyond your LAN

## License

GPL-3.0-only. See `LICENSE`.

## Contributing

Issues and PRs welcome. This started as a personal homelab project — if you
add a new book source or indexer integration, a PR is very welcome.
