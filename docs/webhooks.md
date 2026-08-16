# Webhooks

Deliver loyalty events to your server in real time. Create endpoints from the
dashboard (**Webhooks** tab) or via the API — we POST a JSON payload for every
matching event and sign it with HMAC-SHA256 so you can verify it really came
from us.

## Events

| Event            | Payload key                  | Fires when                                |
| ---------------- | ---------------------------- | ----------------------------------------- |
| `stamp.created`  | `data`                       | A customer earns a stamp (visit).         |
| `reward.created` | `data`                       | A customer reaches the threshold.         |
| `reward.redeemed`| `data`                       | A customer redeems a reward at the register. |

### stamp.created

```json
{
  "event": "stamp.created",
  "businessId": "cmsu...",
  "timestamp": "2026-08-15T11:05:18.313Z",
  "data": {
    "cardId": "cmsu...",
    "customerId": "cmsu...",
    "stamps": 4,
    "source": "QR",
    "orderId": "order_9001"
  }
}
```

`stamps` is the running total for the current cycle. When the threshold is hit,
`stamps` resets to `0` and a separate `reward.created` follows in the same
transaction.

### reward.created

```json
{
  "event": "reward.created",
  "businessId": "cmsu...",
  "timestamp": "2026-08-15T11:05:18.746Z",
  "data": {
    "rewardId": "cmsu...",
    "cardId": "cmsu...",
    "type": "FREE_ITEM",
    "value": 1,
    "expiresAt": "2026-09-14T11:05:17.854Z",
    "threshold": 10
  }
}
```

`type` is one of `PERCENT_OFF`, `FIXED_OFF`, `FREE_ITEM`.

### reward.redeemed

```json
{
  "event": "reward.redeemed",
  "businessId": "cmsu...",
  "timestamp": "2026-08-15T11:11:48.703Z",
  "data": {
    "rewardId": "cmsu...",
    "cardId": "cmsu...",
    "redeemedAt": "2026-08-15T11:11:47.803Z"
  }
}
```

## Headers

Every delivery carries:

- `x-loyalty-event` — the event name (e.g. `stamp.created`).
- `x-loyalty-signature` — `sha256=<hmac>`, the HMAC-SHA256 of the **raw request
  body**, keyed with your endpoint's signing secret.
- `content-type: application/json`

## Verifying signatures

The signing secret is shown once when you create the endpoint. Keep it
server-side. Verify every delivery before trusting it:

```js
import { createHmac, timingSafeEqual } from 'crypto';

export function verifySignature(rawBody, signatureHeader, secret) {
  const [scheme, expected] = signatureHeader.split('=');
  if (scheme !== 'sha256') return false;
  const actual = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## Retry & reliability

- Deliveries are queued in the same database transaction as the event itself,
  so nothing is lost if your server is down.
- We attempt each delivery with exponential backoff (15s → 30s → 1m … capped at
  1h) and stop after 8 attempts. A non-2xx response or a timeout counts as a
  failure. After 8 failures the delivery is **dead-lettered** (`FAILED`) and
  stops being retried automatically.
- Every delivery is claimed atomically (`FOR UPDATE SKIP LOCKED`), so even if
  you run multiple API instances, the same event is never delivered twice
  (exactly one worker handles each row).
- We send exactly once per attempt; because delivery is best-effort over HTTP,
  your receiver should be idempotent — key on `data.rewardId` / `data.cardId` /
  `data.redeemedAt` and de-duplicate.
- Delivery status is visible in the dashboard (**Webhooks → Deliveries**); a
  dead-lettered delivery shows a **Redeliver** button that re-queues it.
- A dead-lettered delivery can be re-queued with a fresh retry budget via the
  dashboard **Redeliver** button or the API:

  ```
  POST /api/v1/businesses/me/webhooks/:id/deliveries/:deliveryId/retry
  ```

  Returns `201 { retried: true }` (or `409` if the delivery is not dead-lettered
  and `404` if it doesn't belong to the endpoint).

## Testing

Use the **Test** button in the dashboard to queue a synthetic `reward.created`
delivery to an endpoint. It arrives within a few seconds.

## Live API docs

The API serves interactive OpenAPI docs at `/docs` (Swagger UI) and the raw spec
at `/docs-json` — the endpoint list includes webhook management, the widget
public API, and the server-to-server stamp endpoint.
