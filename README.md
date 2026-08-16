# Loyalty Widget — Open Source Punch-Card Loyalty System

Drop-in loyalty/stamp-card system for restaurants and small food businesses.
Add one `<script>` tag to any website, reward customers after N visits.

```html
<script
  src="https://cdn.yourloyaltyapp.com/widget.js"
  data-business-id="my-cafe-abc123"
  async
></script>
```

> `data-business-id` accepts either the business **slug** (`my-cafe-abc123`,
> returned at registration) or a `biz_<id>` style identifier.

The widget shows a **Check in** button: customers scan the register QR (via
camera — `BarcodeDetector` where available, `jsQR` fallback) or paste the code
to earn a stamp automatically. Sign-in is a passwordless email/phone OTP.

### Widget options

| Attribute         | Default | Description |
| ----------------- | ------- | ----------- |
| `data-business-id`| —       | Business slug or id (required). |
| `data-api-base`   | hosted  | Override the API base URL (self-hosted instances). |
| `data-position`   | `bottom-right` | `bottom-right` or `bottom-left`. |
| `data-theme`      | `light` | `light` or `dark`. |
| `data-strings`    | —       | JSON object of user-facing copy (e.g. `{"checkIn":"Check in"}`) to localize/rename labels. |
| `data-trigger`    | —       | `manual` hides the launcher and exposes `window.LoyaltyWidget.open()`. |

Accent color is themeable from the host page via the
`--loyalty-accent-color` CSS variable.

## Monorepo layout

```
api/         NestJS + Prisma + PostgreSQL — multi-tenant backend
widget/      Embeddable Web Component (Lit) + CDN loader script
dashboard/   Business owner admin panel (Vite SPA): onboarding checklist,
             stats, check-in QR, snippet generator ("Integrate"), loyalty
             settings with live widget preview
docs/        Integration documentation (quick start, API reference)
```

## Architecture

- **Multi-tenant**: one `Business` row per tenant, scoped by `businessId` everywhere.
- **Two ways to stamp a visit**:
  1. QR self-checkout — the dashboard's check-in screen shows a rotating QR;
     staff or customers scan it from the widget.
  2. Server-to-server API call — business's POS/checkout calls
     `POST /api/v1/stamps` with an API key when an order closes (idempotent).
- **Customer auth**: passwordless OTP (email or phone), short-lived JWT scoped
  to `(customerId, businessId)`. Email codes are delivered via Resend when
  `RESEND_API_KEY` is set; without it they fall back to the API log for local
  development.
- **Business auth**: email/password + JWT access/refresh (per-session rotation,
  multi-device safe), plus a separate long-lived API key for server-to-server
  stamp calls (rotatable from the dashboard).
- **Anti-abuse**: atomic per-card cooldown (race-safe), rate limiting,
  idempotency keys on stamp writes, OTP attempt caps and code invalidation.

## Local development

The API works against **any PostgreSQL** — local or cloud. No Docker required.

### Option A — cloud Postgres (recommended, no Docker)

1. Create a free Postgres database on [Neon](https://neon.tech), 
   [Supabase](https://supabase.com), [Render](https://render.com) or any
   provider (the free tiers are plenty for development).
2. Copy the connection string into `api/.env` as `DATABASE_URL`, keeping the
   `?sslmode=require` part (required by cloud providers):

   ```
   DATABASE_URL="postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require"
   ```

3. Apply the schema and start the API (no Docker needed):

   ```bash
   cd api && npm install
   npx prisma migrate deploy        # creates the tables in your cloud DB
   npm run start:dev
   ```

### Option B — local Postgres via Docker (optional)

```bash
docker compose up -d               # postgres + api (migrations applied on boot)
```

### Frontends

```bash
cd widget && npm install && npm run dev
cd dashboard && npm install && npm run dev     # http://localhost:5174
```

Environment: copy `api/.env.example` to `api/.env`. The API refuses to boot on
placeholder secrets outside development — set `ALLOW_INSECURE_DEV=1` locally,
or generate real secrets (`openssl rand -hex 32`) in production.

## Deployment

Three deployable pieces, all independently hostable:

- **API** — `api/Dockerfile` (Node 20). Runs `prisma migrate deploy` on boot.
- **Dashboard** — `dashboard/Dockerfile` (Vite build served by nginx, which
  proxies `/api/*` and `/docs` to the API).
- **Widget** — a single `dist/widget.js` IIFE you upload to any static host/CDN.

One-command full stack on a single server:

```bash
cp .env.prod.example .env     # fill in secrets (openssl rand -hex 32)
docker compose -f docker-compose.prod.yml up -d --build
```

See [docs/deployment.md](docs/deployment.md) for environment variables, TLS
notes, and widget CDN hosting.

## Tests

```bash
cd api
npm test           # unit tests (stamps, OTP, guards)
npm run test:e2e   # full API flows — requires a database
```

> ⚠️ The e2e suite **deletes all rows** in the database it runs against (it
> boots `AppModule` against `DATABASE_URL`). Point it at a throw-away database,
> not one with real data.

## Status

Core API (auth, stamps, rewards, public widget endpoints), the embeddable
widget, and the business dashboard are implemented here. CI enforces lint,
typecheck, unit and e2e tests for the API and builds for the frontends.

## License

MIT — see [LICENSE](LICENSE). Contributions welcome, see
[CONTRIBUTING.md](CONTRIBUTING.md).