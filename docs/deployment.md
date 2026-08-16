# Deployment

Three deployable pieces, each independently hostable:

| Piece      | What it is                              | Build output               | Hosts it                     |
| ---------- | --------------------------------------- | -------------------------- | ---------------------------- |
| `api/`     | NestJS + Prisma + Postgres API          | Node 20 container          | Your server / PaaS           |
| `dashboard/`| Business owner admin panel (Vite SPA)  | Static files (or nginx)    | Any static host / nginx      |
| `widget/`  | Embeddable `<script>` loyalty widget    | `dist/widget.js` (IIFE)    | Any static host / CDN        |

The widget is the only part customers interact with; it loads from a CDN and
talks to the API over HTTPS. The dashboard and API can live on the same origin
(one nginx) or be split.

---

## Option A — Docker Compose (everything on one server)

`docker-compose.prod.yml` runs PostgreSQL, applies migrations, then starts the
API and the dashboard (served by nginx, which proxies `/api/*` and `/docs` to
the API — so the dashboard itself needs no CORS).

### 1. Configure

```bash
cp .env.prod.example .env
```

Fill in at minimum:

- `POSTGRES_PASSWORD` — a strong database password.
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CUSTOMER_TOKEN_SECRET` — unique
  values, each `openssl rand -hex 32`.
- `CORS_ORIGIN` — comma-separated origins that call the API directly (your
  widget site, e.g. `https://mysite.com`). The API refuses to boot in
  production with a missing or wildcard value.

Optionally set `DATABASE_URL` to an external managed Postgres (Neon, Supabase,
RDS …) instead of the bundled container — the bundled `postgres` service is
still started but unused.

### 2. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f api   # watch health
```

- Dashboard: `http://<host>:8080`
- API + Swagger UI: `http://<host>:3000/docs`

`migrate` runs `prisma migrate deploy` once and the API waits for it to
complete before booting.

### 3. Put TLS in front

Both services are plain HTTP. In production terminate TLS on a reverse proxy
(Caddy, Traefik, nginx, or your platform's load balancer) and forward to ports
`8080` and `3000`. Set `CORS_ORIGIN` to your widget site's origin.

### Environment variables

| Variable              | Required | Notes                                        |
| --------------------- | -------- | -------------------------------------------- |
| `POSTGRES_PASSWORD`   | yes*     | bundled Postgres password (*skip if `DATABASE_URL` is set) |
| `JWT_ACCESS_SECRET`   | yes      | ≥ 24 chars, `openssl rand -hex 32`           |
| `JWT_REFRESH_SECRET`  | yes      | ≥ 24 chars, unique                           |
| `CUSTOMER_TOKEN_SECRET` | yes    | ≥ 24 chars, unique                           |
| `CORS_ORIGIN`         | yes      | widget site origins, comma-separated, no `*` |
| `DATABASE_URL`        | optional | overrides bundled Postgres                   |
| `RESEND_API_KEY`      | optional | sends OTP codes by email; without it codes go to the API log |
| `API_PORT` / `DASHBOARD_PORT` | optional | host ports, default `3000` / `8080` |

---

## Option B — host the API on a PaaS

`api/Dockerfile` is a standard Node 20 image. Any platform that runs containers
(GCP Cloud Run, Fly.io, Render, Railway, Heroku) works:

1. Provision Postgres and set `DATABASE_URL`.
2. Set the secrets and `CORS_ORIGIN`.
3. `npx prisma migrate deploy` must run before the app boots — either as the
   image's `CMD` (already the default) or as a one-off job.
4. Point your dashboard's `VITE_API_BASE` at the deployed API and rebuild it.

---

## Hosting the widget on a CDN

The widget is a single self-contained IIFE script (`widget.js`), no server
required. Any static host/CDN works.

### 1. Build

```bash
cd widget
npm ci
npm run build
# dist/widget.js (+ dist/widget.js.map)
```

### 2. Upload

Upload `dist/widget.js` (and the `.map` for debugging) to your static host:
S3 + CloudFront, Netlify, Cloudflare Pages, GitHub Pages, or even a plain nginx
server.

Serve it with long-lived cache headers (it is immutable until you bump the
filename/version):

```
Cache-Control: public, max-age=31536000, immutable
Content-Type: application/javascript
```

If you self-host, a simple nginx example:

```nginx
location /widget.js {
  alias /srv/loyalty/widget.js;
  add_header Cache-Control "public, max-age=31536000, immutable";
}
```

### 3. Embed

```html
<script
  src="https://cdn.yourdomain.com/widget.js"
  data-business-id="my-cafe-abc123"
  data-api-base="https://api.yourdomain.com/api/v1"
  async
></script>
```

`data-api-base` must point at your deployed API. The API must allow the page's
origin in `CORS_ORIGIN` (it sends credentials/requests from the customer's
browser).

### 4. Versioned deploys

Host with a version in the filename (e.g. `widget@1.4.2.js`) so you can roll
back: publish a new version, update the embed snippet, and the old file stays
served from cache until all pages are updated.

### 5. HTTPS

The widget only loads and talks to the API over HTTPS. Serve the CDN and API
over TLS in production.
