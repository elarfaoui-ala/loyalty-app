import { api } from '../api';
import { el, escapeHtml } from '../dom';

export type WebhookEvent = 'STAMP_CREATED' | 'REWARD_CREATED' | 'REWARD_REDEEMED';

interface WebhookEndpoint {
  id: string;
  url: string;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  deliveries: number;
  secret?: string;
}

interface WebhookDelivery {
  id: string;
  event: WebhookEvent;
  status: 'PENDING' | 'SENT' | 'FAILED';
  attempts: number;
  lastError?: string | null;
  createdAt: string;
  sentAt?: string | null;
}

interface WebhookStats {
  endpoints: { total: number; enabled: number };
  deliveries: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    successRate: number;
    avgAttempts: number;
    retries: number;
  };
  daily: Array<{ day: string; sent: number; failed: number; pending: number }>;
}

const EVENT_LABELS: Record<WebhookEvent, string> = {
  STAMP_CREATED: 'stamp.created',
  REWARD_CREATED: 'reward.created',
  REWARD_REDEEMED: 'reward.redeemed',
};

const EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  STAMP_CREATED: 'A customer earned a stamp (visit).',
  REWARD_CREATED: 'A customer reached the threshold and unlocked a reward.',
  REWARD_REDEEMED: 'A customer redeemed a reward at the register.',
};

export function renderWebhooks(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div>
      <h1>Webhooks</h1>
      <p class="muted">
        Deliver loyalty events to your server in real time. We POST a JSON payload to your URL and
        sign it with HMAC-SHA256 in the <code>x-loyalty-signature</code> header so you can verify it came
        from us.
      </p>

      <div class="card" id="wh-stats-card">
        <h2>Delivery health</h2>
        <p class="muted">Aggregated across all endpoints — last 14 days.</p>
        <div class="msg-error" id="wh-stats-error" style="display:none"></div>
        <div class="stat-grid" id="wh-stat-grid"></div>
        <div id="wh-chart"></div>
      </div>

      <div class="card">
        <h2>Add endpoint</h2>
        <form id="wh-create-form">
          <label for="wh-url">URL</label>
          <input id="wh-url" type="url" required placeholder="https://api.example.com/loyalty/webhook" />
          <div class="check-group">
            ${Object.entries(EVENT_LABELS)
              .map(
                ([value, label]) => `
                  <label class="check-row">
                    <input type="checkbox" value="${value}" checked />
                    <span>
                      <strong>${label}</strong>
                      <span class="muted"> — ${EVENT_DESCRIPTIONS[value as WebhookEvent]}</span>
                    </span>
                  </label>
                `,
              )
              .join('')}
          </div>
          <div class="msg-error" style="display:none"></div>
          <div class="msg-ok" style="display:none"></div>
          <button class="primary" type="submit">Add endpoint</button>
        </form>
      </div>

      <div class="card" id="wh-list-card">
        <h2>Endpoints</h2>
        <div class="msg-error" id="wh-list-error" style="display:none"></div>
        <div id="wh-list"></div>
      </div>
    </div>
  `);
  app.replaceChildren(view);

  const list = view.querySelector<HTMLElement>('#wh-list')!;
  const listError = view.querySelector<HTMLElement>('#wh-list-error')!;
  const createForm = view.querySelector<HTMLFormElement>('#wh-create-form')!;
  const createError = view.querySelector<HTMLElement>('#wh-create-form .msg-error')!;
  const createOk = view.querySelector<HTMLElement>('#wh-create-form .msg-ok')!;
  const statsGrid = view.querySelector<HTMLElement>('#wh-stat-grid')!;
  const chartSlot = view.querySelector<HTMLElement>('#wh-chart')!;
  const statsError = view.querySelector<HTMLElement>('#wh-stats-error')!;

  const statTile = (value: string, label: string): HTMLElement => {
    const node = el('<div class="stat"></div>');
    const valueEl = el(`<div class="value">${escapeHtml(value)}</div>`);
    const labelEl = el(`<div class="label">${escapeHtml(label)}</div>`);
    node.append(valueEl, labelEl);
    return node;
  };

  const renderChart = (stats: WebhookStats) => {
    const maxTotal = Math.max(
      1,
      ...stats.daily.map((d) => d.sent + d.failed + d.pending),
    );
    const seg = (count: number, cls: 'sent' | 'failed' | 'pending') =>
      count > 0
        ? `<div class="wh-chart-seg ${cls}" style="height:${(count / maxTotal) * 100}%"></div>`
        : '';
    const days = stats.daily
      .map(
        (d) => `
        <div class="wh-chart-col" title="${escapeHtml(d.day)}">
          <div class="wh-chart-bars">
            ${seg(d.sent, 'sent')}
            ${seg(d.failed, 'failed')}
            ${seg(d.pending, 'pending')}
          </div>
          <span class="wh-chart-day">${escapeHtml(d.day.slice(5))}</span>
        </div>
      `,
      )
      .join('');
    const legend = (
      [
        ['sent', stats.deliveries.sent],
        ['failed', stats.deliveries.failed],
        ['pending', stats.deliveries.pending],
      ] as const
    )
      .map(
        ([key, count]) => `
        <span class="wh-legend-item">
          <span class="wh-dot wh-dot-${key}"></span>
          ${key[0].toUpperCase()}${key.slice(1)} · ${count}
        </span>
      `,
      )
      .join('');
    chartSlot.replaceChildren(
      el(`<div><div class="wh-chart">${days}</div><div class="wh-legend">${legend}</div></div>`),
    );
  };

  const loadStats = async () => {
    try {
      const stats = await api<WebhookStats>('/businesses/me/webhooks/stats');
      const d = stats.deliveries;
      const completed = d.sent + d.failed;
      const rate =
        completed > 0 ? `${Math.round(d.successRate * 100)}% of completed` : 'no completed deliveries';
      statsGrid.replaceChildren(
        statTile(String(d.sent), `Delivered · ${rate}`),
        statTile(String(d.failed), 'Dead-lettered'),
        statTile(String(d.retries), 'Retries'),
        statTile(d.avgAttempts.toFixed(1), 'Avg attempts'),
      );
      renderChart(stats);
    } catch (err) {
      statsError.textContent = (err as Error).message;
      statsError.style.display = '';
    }
  };

  const showListError = (message: string) => {
    listError.textContent = message;
    listError.style.display = '';
  };

  const endpoints = async (): Promise<WebhookEndpoint[]> =>
    api<WebhookEndpoint[]>('/businesses/me/webhooks');

  const toggleEndpoint = async (id: string, enabled: boolean) => {
    await api<WebhookEndpoint>(`/businesses/me/webhooks/${id}`, {
      method: 'PATCH',
      body: { enabled },
    });
    void renderEndpoints();
  };

  const sendTest = async (id: string) => {
    await api<{ ok: boolean }>(`/businesses/me/webhooks/${id}/test`, { method: 'POST' });
    void renderEndpoints();
  };

  const removeEndpoint = async (id: string) => {
    const confirmed = window.confirm(
      'Delete this webhook endpoint? It will stop receiving events immediately.',
    );
    if (!confirmed) return;
    await api<{ ok: boolean }>(`/businesses/me/webhooks/${id}`, { method: 'DELETE' });
    void renderEndpoints();
  };

  const deliveriesFor = async (id: string): Promise<WebhookDelivery[]> =>
    api<WebhookDelivery[]>(`/businesses/me/webhooks/${id}/deliveries?limit=10`);

  const badge = (status: WebhookDelivery['status']) => {
    const label =
      status === 'FAILED' ? 'Dead-lettered' : status === 'SENT' ? 'Sent' : 'Pending';
    const cls = status === 'SENT' ? 'tag-ok' : status === 'FAILED' ? 'tag-err' : 'tag-warn';
    return `<span class="tag ${cls}">${label}</span>`;
  };

  const redeliver = async (endpointId: string, deliveryId: string) => {
    await api<{ retried: boolean }>(
      `/businesses/me/webhooks/${endpointId}/deliveries/${deliveryId}/retry`,
      { method: 'POST' },
    );
  };

  const renderDeliveries = async (endpointId: string, slot: HTMLElement) => {
    slot.replaceChildren(el('<p class="muted">Loading deliveries…</p>'));
    try {
      const rows = await deliveriesFor(endpointId);
      if (rows.length === 0) {
        slot.replaceChildren(
          el('<p class="muted">No deliveries yet. Trigger an event or press Test.</p>'),
        );
        return;
      }
      const frag = document.createDocumentFragment();
      for (const d of rows) {
        const node = el(`
          <div class="wh-delivery">
            <div>
              <strong>${escapeHtml(EVENT_LABELS[d.event])}</strong>
              ${badge(d.status)}
              ${d.attempts > 1 ? `<span class="muted">${d.attempts} attempts</span>` : ''}
            </div>
            <div class="wh-delivery-meta">
              <span class="muted">
                ${new Date(d.createdAt).toLocaleString()}
                ${d.status === 'FAILED' && d.lastError ? ` — ${escapeHtml(d.lastError)}` : ''}
              </span>
              ${d.status === 'FAILED' ? '<button class="secondary" type="button">Redeliver</button>' : ''}
            </div>
          </div>
        `);
        const btn = node.querySelector<HTMLButtonElement>('button');
        btn?.addEventListener('click', () => {
          btn.disabled = true;
          btn.textContent = 'Queuing…';
          redeliver(endpointId, d.id)
            .then(() => renderDeliveries(endpointId, slot))
            .catch((err) => {
              btn.textContent = 'Redeliver';
              btn.disabled = false;
              window.alert((err as Error).message);
            });
        });
        frag.append(node);
      }
      slot.replaceChildren(frag);
    } catch {
      slot.replaceChildren(el('<p class="muted">Could not load deliveries.</p>'));
    }
  };

  const renderEndpoints = async () => {
    try {
      const items = await endpoints();
      list.replaceChildren();
      if (items.length === 0) {
        list.append(
          el('<p class="muted">No webhook endpoints yet. Add one above to start receiving events.</p>'),
        );
        return;
      }
      for (const ep of items) {
        const row = el(`
          <div class="wh-endpoint">
            <div class="wh-ep-head">
              <div class="wh-ep-url">${escapeHtml(ep.url)}</div>
              <label class="switch-row">
                <input type="checkbox" ${ep.enabled ? 'checked' : ''} />
                <span>${ep.enabled ? 'Enabled' : 'Paused'}</span>
              </label>
            </div>
            <div class="wh-ep-events">
              ${ep.events.map((e) => `<span class="tag">${escapeHtml(EVENT_LABELS[e])}</span>`).join('')}
            </div>
            <div class="wh-ep-actions">
              <button class="secondary" type="button">Test</button>
              <button class="secondary" type="button">Deliveries${ep.deliveries ? ` (${ep.deliveries})` : ''}</button>
              <button class="danger" type="button">Delete</button>
            </div>
            <div class="wh-deliveries" style="display:none"></div>
          </div>
        `);

        const toggle = row.querySelector<HTMLInputElement>('input[type=checkbox]')!;
        toggle.addEventListener('change', () => {
          toggle.disabled = true;
          toggleEndpoint(ep.id, toggle.checked)
            .catch(() => {
              toggle.checked = !toggle.checked;
            })
            .finally(() => {
              toggle.disabled = false;
            });
        });

        const [testBtn, deliveriesBtn, deleteBtn] = row.querySelectorAll<HTMLButtonElement>('button');
        const deliveriesSlot = row.querySelector<HTMLElement>('.wh-deliveries')!;

        testBtn.addEventListener('click', () => {
          testBtn.disabled = true;
          sendTest(ep.id)
            .catch(() => {
              testBtn.textContent = 'Failed';
            })
            .finally(() => {
              testBtn.textContent = 'Test';
              testBtn.disabled = false;
            });
        });

        deliveriesBtn.addEventListener('click', () => {
          const hidden = deliveriesSlot.style.display === 'none';
          deliveriesSlot.style.display = hidden ? '' : 'none';
          if (hidden) void renderDeliveries(ep.id, deliveriesSlot);
        });

        deleteBtn.addEventListener('click', () => {
          void removeEndpoint(ep.id);
        });

        list.append(row);
      }
    } catch (err) {
      showListError((err as Error).message);
    }
  };

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createOk.style.display = 'none';
    createError.style.display = 'none';
    const url = view.querySelector<HTMLInputElement>('#wh-url')!.value.trim();
    const events = Array.from(
      createForm.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked'),
    ).map((input) => input.value as WebhookEvent);
    if (!url) return;
    if (events.length === 0) {
      createError.textContent = 'Pick at least one event.';
      createError.style.display = '';
      return;
    }
    try {
      const created = await api<WebhookEndpoint>('/businesses/me/webhooks', {
        method: 'POST',
        body: { url, events },
      });
      view.querySelector<HTMLInputElement>('#wh-url')!.value = '';
      createOk.textContent = 'Endpoint added.';
      createOk.style.display = '';
      if (created.secret) {
        window.alert(
          'Webhook created. Save this signing secret now — it is shown only once:\n\n' +
            created.secret,
        );
      }
  void renderEndpoints();
  void loadStats();
    } catch (err) {
      createError.textContent = (err as Error).message;
      createError.style.display = '';
    }
  });

  void renderEndpoints();

  return { destroy: () => view.remove() };
}
