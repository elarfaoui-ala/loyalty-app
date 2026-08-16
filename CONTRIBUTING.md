# Contributing

Thanks for your interest in Loyalty Widget. This is a small, open-source
project, so a little structure goes a long way.

## Project layout

```
api/         NestJS + Prisma + PostgreSQL backend (multi-tenant)
widget/      Embeddable Web Component (Lit) + CDN loader script
dashboard/   Business owner admin panel (Vite + vanilla TypeScript SPA)
docs/        Integration documentation (quick start, API reference)
```

## Development setup

1. Follow the quick start in the root `README.md` to get the API running
   against any PostgreSQL database.
2. Frontends run standalone with Vite dev servers:

   ```bash
   cd widget && npm install && npm run dev
   cd dashboard && npm install && npm run dev   # http://localhost:5174
   ```

## Code style and checks

The API enforces ESLint, strict TypeScript, and Jest tests. Run from `api/`:

```bash
npm run lint:check   # eslint, no auto-fix
npm run build        # tsc + nest build (must emit dist/main.js)
npm test             # unit tests
```

Frontends must typecheck and build:

```bash
cd widget && npm run build
cd dashboard && npm run build
```

## Testing notes

- `npm run test:e2e` **deletes every row** in the database it runs against
  (it boots `AppModule` against `DATABASE_URL`). Point it at a throw-away
  database, never one with real data.

## Submitting changes

- Keep pull requests focused and small; explain the motivation in the
  description.
- Add or update tests for API changes (unit for logic, e2e for endpoint
  flows).
- Make sure lint, typecheck, and tests pass before opening the PR.

## License

This project is MIT-licensed (see `LICENSE`). By contributing you agree to
license your contribution under the same terms.
