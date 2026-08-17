# Loyalty Widget — Open Source Punch-Card Loyalty System

Drop-in loyalty/stamp-card system for restaurants and small food businesses.
Add one `<script>` tag to any website, reward customers after N visits.

```html
<script
  src="https://cdn.yourloyaltyapp.com/widget.js"
  data-business-id="my-cafe-abc123"
  data-api-base="https://api.example.com/api/v1"
  async
></script>
```

> `data-business-id` accepts either the business **slug** (`my-cafe-abc123`,
> returned at registration) or a `biz_<id>` style identifier.

The widget shows a **Check in** button: customers scan the register QR (via
camera — `BarcodeDetector` where available, `jsQR` fallback) or paste the code
to earn a stamp automatically. Sign-in is a passwordless email/phone OTP.

## Architecture

```mermaid
flowchart TB
  subgraph Browser
    W[Widget <script>]
    D[Dashboard SPA]
  end

  subgraph Server
    API[NestJS API]
    PG[(PostgreSQL)]
    WK[Webhook worker]
  end

  W -- REST --> API
  D -- REST --> API
  POS[POS / checkout] -- API key --> API
  API -- read/write --> PG
  API -- emit --> WK
  WK -- POST signed --> WH[Webhook receiver]
```

**Multi-tenant** — one `Business` row per tenant, scoped by `businessId`
everywhere. **Two ways to stamp a visit**:

1. **QR self-checkout** — the dashboard's check-in screen shows a rotating QR;
   staff or customers scan it from the widget.
2. **Server-to-server** — business's POS calls `POST /api/v1/stamps` with an
   API key when an order closes (idempotent).

**Auth**: passwordless OTP for customers; email/password + per-session JWT
rotation for businesses; long-lived API keys for server-to-server stamp calls.
**Webhooks**: signed (HMAC-SHA256) delivery with exponential backoff, dead
letters, manual retry, and per-day delivery stats.

## Widget options

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

### Customization examples

```html
<!-- Dark theme, left-aligned, custom copy -->
<script
  src="https://cdn.yourdomain.com/widget.v1.js"
  data-business-id="my-cafe-abc123"
  data-api-base="https://api.example.com/api/v1"
  data-theme="dark"
  data-position="bottom-left"
  data-strings='{"checkIn":"Stamp my card"}'
  async
></script>

<!-- Manual trigger — open from your own button -->
<script
  src="https://cdn.yourdomain.com/widget.v1.js"
  data-business-id="my-cafe-abc123"
  data-api-base="https://api.example.com/api/v1"
  data-trigger="manual"
  async
></script>
<script>
  document.getElementById('loyalty-btn').addEventListener('click', () => {
    window.LoyaltyWidget.open();
  });
</script>
```

## Project structure

```
api/
  src/
    auth/           Login, register, refresh, change-password
    businesses/     Profile, onboarding, API key rotation, stats
    stamps/         Stamp & reward logic (idempotent, cooldown-safe)
    webhooks/       Outbox delivery, retry, dead-letter, stats
    public/         OTP issuance & verification (no auth)
    common/         Guards, filters, mail service
  prisma/
    schema.prisma   Full data model
    migrations/     Versioned SQL migrations
  test/
    app.e2e-spec.ts Full API flow tests (28 cases)
dashboard/
  src/
    api.ts          Authenticated fetch wrapper (auto-refresh)
    views/          One file per route (login, overview, check-in, etc.)
widget/
  src/
    loyalty-widget-element.ts   Lit Web Component
    api-client.ts               Lightweight REST client
    loader.ts                   <script> tag entry point
docs/
  quick-start.md    Business setup guide
  webhooks.md       Webhook integration guide
  deployment.md     Compose, PaaS, and CDN hosting
```

## API reference

Start the API and open **Swagger UI** at [http://localhost:3000/docs](http://localhost:3000/docs)
for an interactive API explorer with request/response examples and auth
setup.

Key endpoint groups:

| Group | Auth | Description |
| ----- | ---- | ----------- |
| `POST /auth/business/register` | none | Register a new business, get API key + tokens |
| `POST /auth/business/login` | none | Email/password login |
| `POST /stamps` | API key | Stamp a visit (idempotent) |
| `GET /businesses/me/webhooks/stats` | JWT | Delivery success rate, retries, per-day series |
| `GET /businesses/{idOrSlug}/config` | none | Widget config (public) |
| `POST /public/otp/send` | none | Send OTP code |
| `POST /public/otp/verify` | none | Verify OTP, get customer token |

Full reference: see the Swagger UI or the e2e test suite
(`api/test/app.e2e-spec.ts`) for working request/response examples.

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

### Required environment variables

| Variable              | Required | Notes |
| --------------------- | -------- | ----- |
| `DATABASE_URL`        | yes | Postgres connection string |
| `JWT_ACCESS_SECRET`   | yes | ≥ 24 chars, `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET`  | yes | ≥ 24 chars, unique |
| `CUSTOMER_TOKEN_SECRET` | yes | ≥ 24 chars, unique |
| `CORS_ORIGIN`         | prod only | Widget site origins, comma-separated |
| `RESEND_API_KEY`      | optional | Email OTP delivery; without it codes are logged |
| `ALLOW_INSECURE_DEV`  | dev only | Set to `1` to skip secret length checks |

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

## Webhooks

Register a URL to receive loyalty events (`stamp.created`, `reward.created`,
`reward.redeemed`) in real time. Payloads are HMAC-SHA256 signed; deliveries
retry with exponential backoff up to 8 attempts, then dead-letter for manual
redelivery.

See [docs/webhooks.md](docs/webhooks.md) for payload format, signature
verification, and integration examples.

## Tests

```bash
cd api
npm test           # unit tests (20 cases — stamps, OTP, guards)
npm run test:e2e   # full API flows (28 cases) — requires a database
```

CI runs both suites against a real Postgres service container on every push
to `main`.

> ⚠️ The e2e suite **deletes all rows** in the database it runs against (it
> boots `AppModule` against `DATABASE_URL`). Point it at a throw-away database,
> not one with real data.

## Status

Core API (auth, stamps, rewards, public widget endpoints), the embeddable
widget, and the business dashboard are implemented and verified in CI. CI
enforces lint, typecheck, unit and e2e tests for the API, builds for both
frontends, and a full Docker compose smoke test (postgres → migrate → API →
dashboard health check through nginx).

Delivery observability: aggregate webhook stats endpoint, per-day stacked bar
chart in the dashboard, dead-letter count and retry metrics.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and how to run
the full test suite.

## License

MIT — see [LICENSE](LICENSE).
