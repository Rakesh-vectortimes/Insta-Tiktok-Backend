# Insta-Tiktok Backend

Node.js API for downloading Instagram and TikTok media. Supports reels, posts, carousels, profile pictures, stories, TikTok videos, audio extraction, and slideshows.

## Features

- **Instagram** — reels, posts, carousel ZIP downloads, profile pictures, stories
- **TikTok** — watermark-free video download, MP3 audio extraction, slideshow image extraction
- **Multiple formats** — MP4 video and MP3 audio with quality options (360p–1080p)
- **Swagger docs** — interactive API documentation at `/api-docs`
- **Rate limiting** — 30 requests per 10 minutes per IP

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (must be on your `PATH`)
- [FFmpeg](https://ffmpeg.org/) (required for audio extraction)

## Installation

```bash
git clone https://github.com/Rakesh-vectortimes/Insta-Tiktok-Backend.git
cd Insta-Tiktok-Backend
npm install
```

Copy the example env file and configure as needed:

```bash
cp .env.example .env
```

### Instagram cookies (recommended)

Most Instagram endpoints work best with authenticated cookies:

1. Install the [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) Chrome extension
2. Log in to [instagram.com](https://www.instagram.com)
3. Export cookies and save as `cookies.txt` in the project root

See `cookies.txt.example` for the expected file name. **Never commit real cookie files.**

Alternative auth options (set in `.env`):

- `INSTAGRAM_COOKIES_BROWSER=chrome` — read cookies from a local browser
- `INSTAGRAM_SESSION_ID=...` — pass a session ID directly

## Running

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:4000` by default (`PORT` in `.env`).

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API overview |
| `GET` | `/health` | Health check and cookie status |
| `GET` | `/api-docs` | Swagger UI |

### Instagram

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/instagram/reel` | Get reel metadata and download links |
| `GET` | `/api/instagram/reel/stream` | Stream reel as MP4 or MP3 |
| `POST` | `/api/instagram/post` | Get post metadata (image, video, or carousel) |
| `POST` | `/api/instagram/carousel/zip` | Download carousel as ZIP |
| `GET` | `/api/instagram/download` | Proxy CDN media download |
| `GET` | `/api/instagram/dp/:username` | Profile picture and user info |
| `POST` | `/api/instagram/story` | Story metadata (requires auth) |
| `GET` | `/api/instagram/story/stream` | Stream story video |

### TikTok

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/tiktok/video` | Get video metadata and download links |
| `GET` | `/api/tiktok/video/stream` | Stream video as MP4 or MP3 |
| `POST` | `/api/tiktok/audio` | Extract and download MP3 audio |
| `POST` | `/api/tiktok/slideshow` | Get slideshow image URLs |

### Example

```bash
# Get Instagram reel info
curl -X POST http://localhost:4000/api/instagram/reel \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.instagram.com/reel/ABC123/", "format": "mp4", "quality": "720"}'

# Get TikTok video info
curl -X POST http://localhost:4000/api/tiktok/video \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.tiktok.com/@user/video/1234567890"}'
```

Optional body/query params for video endpoints: `format` (`mp4` | `mp3`), `quality` (`360` | `480` | `720` | `1080`).

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4000` | Server port |
| `FRONTEND_URL` | `*` | CORS allowed origin |
| `INSTAGRAM_COOKIES_BROWSER` | — | Browser name for yt-dlp cookie import |
| `INSTAGRAM_SESSION_ID` | — | Instagram session ID fallback |
| `COOKIE_FILE_PATH` | — | Custom path to write/read cookies file |
| `COOKIES_TXT_CONTENT` | — | Full `cookies.txt` content (for Railway Trial — no volumes) |

## Project Structure

```
src/
├── app.js              # Express server entry point
├── config/swagger.js   # OpenAPI / Swagger spec
├── routes/
│   ├── instagram.js    # Instagram endpoints
│   └── tiktok.js       # TikTok endpoints
├── services/
│   ├── igScraper.js    # Instagram GraphQL scraper
│   ├── urlParser.js    # URL parsing helpers
│   └── ytdlp.js        # yt-dlp wrapper
└── utils/
    ├── cleanup.js      # Temp file cleanup
    ├── cookies.js      # Cookie file handling
    └── mediaOptions.js # Format/quality parsing
```

## Deployment

This backend requires **yt-dlp** and **ffmpeg** as system binaries, so it must run on a platform that supports Docker (not Vercel/Netlify).

**Recommended:** [Railway](https://railway.app) or [Render](https://render.com) — both auto-detect the included `Dockerfile`.

### Railway

1. Sign in at Railway with GitHub → **New Project** → **Deploy from GitHub repo** → select this repo
2. Add environment variables:
   - `FRONTEND_URL=https://your-frontend-domain.com`
   - `COOKIES_TXT_CONTENT` — full cookies file content (see below)
   - **Do not set `PORT`** — Railway injects it automatically; overriding it can break health checks
3. **Settings** → **Networking** → **Generate Domain**

Verify:

```bash
curl https://your-app.up.railway.app/health
```

Deploy logs should show: `[cookies] Wrote cookies from env to /app/cookies.txt`

### Instagram cookies on the server

There is no browser on the server, so `INSTAGRAM_COOKIES_BROWSER` will not work in production. **Never commit cookie files** to this public repo.

**Trial plan (no volumes):** store the entire `cookies.txt` as `COOKIES_TXT_CONTENT`. On boot, the server writes it to disk automatically.

Convert your local file to a single-line escaped string:

```bash
node -e "console.log(JSON.stringify(require('fs').readFileSync('cookies.txt','utf8')))"
```

Copy the value **between the outer quotes** into Railway → **Variables** → `COOKIES_TXT_CONTENT`. The server unescapes `\n`, `\t`, and `\r` automatically.

**Hobby plan+ (optional):** mount a volume at `/app/data`, set `COOKIE_FILE_PATH=/app/data/cookies.txt`, and upload via the Railway shell instead.

Update your frontend env:

```env
VITE_API_URL=https://your-app.up.railway.app
```

### Product scope (public-only by default)

This backend matches the **FastDL model**: no login, no cookies, public content only.

**Supported:** public Instagram posts/reels, public TikTok videos  
**Not supported (default):** private accounts, stories, anything not viewable in a logged-out browser tab

Set `ALLOW_SESSION_FALLBACK=true` only if you want opt-in session support later (stories/private).

### Primary API (production pipeline)

```text
POST /api/analyze        → cache check → dedupe → queue job
GET  /api/status/:jobId  → poll job result + CDN URL
POST /api/prewarm        → queue trending URLs ahead of time
```

**Flow:**

```text
User → POST /api/analyze → Redis cache (video:{hash})
  → hit: return CDN URL immediately
  → miss: dedupe lock → BullMQ worker
    → public extractor (no session)
    → session fallback if needed
    → upload to R2 → cache CDN URL (24h)
```

### Production scale (50k+ users)

For high traffic, add these services:

| Service | Purpose |
|---------|---------|
| **Redis** (Railway/Upstash) | Shared cache + BullMQ job queue |
| **Worker** (`npm run worker`) | Background analyze jobs — deploy as 2nd Railway service |
| **Session pool** | Multiple Instagram accounts via `INSTAGRAM_SESSION_POOL` |
| **Cloudflare R2** | CDN media storage (`MIRROR_TO_CDN=true`) |

**Minimum production env:**

```env
REDIS_URL=redis://...
INSTAGRAM_SESSION_POOL=[{"id":"s1","cookiesContent":"...","maxDaily":500},{"id":"s2","cookiesContent":"...","maxDaily":500}]
MIRROR_TO_CDN=true
R2_BUCKET=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_URL=https://cdn.yourdomain.com
FORCE_ASYNC_JOBS=true
GLOBAL_MAX_CONCURRENT=200
```

**Async jobs (spike traffic):**

```bash
POST /api/jobs/analyze   # returns jobId
GET  /api/jobs/:jobId    # poll for result
```

**Architecture:**

```text
User → API → Redis cache → BullMQ queue → Worker → Session pool → Downloader → R2/CDN
```

> One session cannot serve millions of users. Scale with **multiple sessions** in the pool + **horizontal workers** + **CDN**. The queue protects your backend; the session pool reduces Instagram blocking risk.

## License

MIT
