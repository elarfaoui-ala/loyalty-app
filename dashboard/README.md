# Dashboard

Business-owner admin panel for the loyalty system — a lightweight Vite SPA
(no framework, ~40KB gzipped total) talking to the NestJS API.

## Pages

| Route       | Purpose                                                                 |
|-------------|-------------------------------------------------------------------------|
| `#/login`   | Business sign in / account creation (API key shown once on register)    |
| `#/overview`| KPI cards from `GET /api/v1/businesses/me/stats`                        |
| `#/checkin` | Full-screen rotating QR for the register/tablet — customers scan it in the widget to check in. Re-requests `POST /businesses/me/checkin-token` every 20s (tokens expire after 30s) |
| `#/settings`| Loyalty rules + branding (`PATCH /businesses/me`), API key display + rotation (`POST /businesses/me/api-keys/rotate`) |

## Local development

```bash
cd dashboard
npm install
npm run dev          # http://localhost:5174
```

Point the app at a local API:

```bash
# .env.local
VITE_API_BASE=http://localhost:3000/api/v1
```

The API runs on `http://localhost:3000/api/v1` and `CORS_ORIGIN` must include
`http://localhost:5174` when it is not `*`.

## Production build

```bash
npm run build        # outputs to dist/
npm run lint:check
npm run typecheck
```

## Notes

- Access tokens are stored per-tab (localStorage); on a 401 the app
  transparently refreshes with the stored refresh token and retries once.
- The check-in QR encodes a short-lived JWT signed with the business's access
  secret; it expires in 30s and is refreshed automatically.