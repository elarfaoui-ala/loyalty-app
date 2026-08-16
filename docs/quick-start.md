# Quick Start

> Interactive API docs (Swagger UI): start the API and open `http://localhost:3000/docs`.
> Webhook reference: [docs/webhooks.md](webhooks.md).

## 1. Database — use a cloud Postgres (no Docker needed)

Pick any managed PostgreSQL — [Neon](https://neon.tech) (serverless, generous
free tier) is the easiest. Create a project/database and copy its connection
string into `api/.env`:

```
DATABASE_URL="postgresql://user:password@ep-xxx.aws.neon.tech/neondb?sslmode=require"
```

Keep the `?sslmode=require` suffix — cloud providers require SSL. Supabase
users should use the port 5432 direct connection or the pooler with
`?sslmode=require&pgbouncer=true`.

Apply the schema:

```bash
cd api && npm install
npx prisma migrate deploy
npm run start:dev
```

> Local alternative (requires Docker): `docker compose up -d` starts postgres
> and the API together.

## 2. Create your business account

```bash
curl -X POST http://localhost:3000/api/v1/auth/business/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Ala'"'"'s Diner","email":"owner@diner.com","password":"a-strong-password","stampThreshold":10}'
```

Save the `apiKey` from the response — it's shown once (rotate it later from the
dashboard). The `business.slug` is what you embed in the widget.

## 3. Try the widget locally

With the dashboard and the API running, walk through the full flow:

```bash
cd widget && npm install && npm run dev     # http://localhost:5173
```

Open `http://localhost:5173/demo.html`, set `business-id` to your registered
slug, and you'll get the floating rewards button. Log in with your email, then
scan the QR from the dashboard's Check-in screen to earn a stamp.

For production embedding on any website, serve the built file from `dist/`
(`npm run build`, then host `widget.js` on a CDN) and use:

```html
<!-- before closing </body> -->
<script
  src="https://cdn.yourloyaltyapp.com/widget.js"
  data-business-id="alas-diner-abc123"
  data-api-base="https://api.yourloyaltyapp.com/api/v1"
  async
></script>
```

That's it — a floating rewards button appears. Customers log in with a one-time
code (email or phone), and can check in via the QR on your staff screen.

The `data-business-id` accepts either the business **slug** or a `biz_<id>`-style
identifier.

## 4. Staff check-in screen

Open the dashboard (`cd dashboard && npm install && npm run dev`, then
`/checkin`): it shows a full-screen QR that rotates every 20 seconds. Customers
scan it inside the widget to get stamped — no staff action needed beyond keeping
the screen visible.

## 5. (Optional) Auto-stamp from your checkout

If you have your own POS/checkout backend, call the stamp endpoint when an
order closes so customers don't need to scan anything:

```bash
curl -X POST http://localhost:3000/api/v1/stamps \
  -H "x-api-key: biz_a1b2c3d4.YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"customerEmail":"jane@example.com","orderId":"order_9001","idempotencyKey":"order_9001"}'
```

Always pass `idempotencyKey` (your own order id works well) so retries never
double-stamp a customer.

## 6. Advanced widget options

```html
<script
  src="https://cdn.yourloyaltyapp.com/widget.js"
  data-business-id="alas-diner-abc123"
  data-position="bottom-left"
  data-theme="dark"
  data-trigger="manual"
  async
></script>

<button onclick="LoyaltyWidget.open()">My Rewards</button>
```

Or render it inline instead of as a popup:

```html
<loyalty-widget business-id="alas-diner-abc123" inline></loyalty-widget>
```