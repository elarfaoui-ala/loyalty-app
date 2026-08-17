import { api } from '../api';
import { el, escapeHtml } from '../dom';

interface CustomerCard {
  stamps: number;
  totalRedeemed: number;
  lastStampAt: string | null;
  joinedAt: string;
}

interface CustomerListItem {
  id: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  card: CustomerCard | null;
}

interface StampEvent {
  id: string;
  source: string;
  orderId: string | null;
  createdAt: string;
}

interface Reward {
  id: string;
  type: string;
  value: number;
  status: string;
  createdAt: string;
  redeemedAt: string | null;
  expiresAt: string;
}

interface CustomerDetail {
  id: string;
  email: string | null;
  phone: string | null;
  createdAt: string;
  card: {
    id: string;
    stamps: number;
    totalRedeemed: number;
    lastStampAt: string | null;
    joinedAt: string;
    stampEvents: StampEvent[];
    rewards: Reward[];
  };
}

interface CustomerListResponse {
  items: CustomerListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const SOURCE_LABELS: Record<string, string> = {
  QR: 'QR scan',
  API: 'POS',
  MANUAL: 'Manual',
};

const REWARD_STATUS_CLS: Record<string, string> = {
  PENDING: 'tag-warn',
  REDEEMED: 'tag-ok',
  EXPIRED: 'tag-err',
};

export function renderCustomers(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div>
      <h1>Customers</h1>
      <p class="muted">People who have checked in at your business.</p>

      <div class="card cust-search-card">
        <div class="cust-search-row">
          <input id="cust-q" type="search" placeholder="Search by email or phone…" />
          <select id="cust-sort">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="stamps_desc">Most stamps</option>
            <option value="stamps_asc">Fewest stamps</option>
          </select>
        </div>
        <div class="msg-error" id="cust-error" style="display:none"></div>
      </div>

      <div class="card" id="cust-summary-card" style="display:none">
        <div class="stat-grid" id="cust-summary"></div>
      </div>

      <div class="card">
        <h2>Add customer</h2>
        <form id="cust-add-form">
          <label for="cust-add-email">Email</label>
          <input id="cust-add-email" type="email" placeholder="customer@example.com" />
          <label for="cust-add-phone">Phone (optional)</label>
          <input id="cust-add-phone" type="tel" placeholder="+1234567890" />
          <div class="msg-error" id="cust-add-error" style="display:none"></div>
          <div class="msg-ok" id="cust-add-ok" style="display:none"></div>
          <button class="primary" type="submit">Add customer</button>
        </form>
      </div>

      <div class="card" id="cust-list-card">
        <h2>Customers</h2>
        <div id="cust-list"><p class="muted">Loading…</p></div>
        <div id="cust-pager" style="display:none" class="cust-pager"></div>
      </div>

      <div id="cust-detail-slot"></div>
    </div>
  `);
  app.replaceChildren(view);

  const qInput = view.querySelector<HTMLInputElement>('#cust-q')!;
  const sortSelect = view.querySelector<HTMLSelectElement>('#cust-sort')!;
  const listEl = view.querySelector<HTMLElement>('#cust-list')!;
  const errorEl = view.querySelector<HTMLElement>('#cust-error')!;
  const pagerEl = view.querySelector<HTMLElement>('#cust-pager')!;
  const summaryCard = view.querySelector<HTMLElement>('#cust-summary-card')!;
  const summaryEl = view.querySelector<HTMLElement>('#cust-summary')!;
  const detailSlot = view.querySelector<HTMLElement>('#cust-detail-slot')!;

  let currentPage = 1;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const statTile = (value: string, label: string): HTMLElement => {
    const node = el('<div class="stat"></div>');
    node.append(
      el(`<div class="value">${escapeHtml(value)}</div>`),
      el(`<div class="label">${escapeHtml(label)}</div>`),
    );
    return node;
  };

  const renderList = async () => {
    errorEl.style.display = 'none';
    listEl.replaceChildren(el('<p class="muted">Loading…</p>'));
    try {
      const q = qInput.value.trim();
      const sort = sortSelect.value as CustomerListResponse extends { sort?: infer S } ? S : never;
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      params.set('page', String(currentPage));
      params.set('limit', '20');
      params.set('sort', sort);

      const data = await api<CustomerListResponse>(
        `/businesses/me/customers?${params.toString()}`,
      );

      // Summary
      if (data.total > 0) {
        summaryCard.style.display = '';
        summaryEl.replaceChildren(
          statTile(String(data.total), 'Total customers'),
        );
      } else {
        summaryCard.style.display = 'none';
      }

      // List
      listEl.replaceChildren();
      if (data.items.length === 0) {
        listEl.append(
          el(
            q
              ? '<p class="muted">No customers match your search.</p>'
              : '<p class="muted">No customers yet. Customers appear after their first check-in.</p>',
          ),
        );
        pagerEl.style.display = 'none';
        return;
      }

      for (const c of data.items) {
        const identifier = c.email || c.phone || 'Unknown';
        const stamps = c.card?.stamps ?? 0;
        const totalRedeemed = c.card?.totalRedeemed ?? 0;
        const lastStamp = c.card?.lastStampAt
          ? new Date(c.card.lastStampAt).toLocaleDateString()
          : 'never';

        const row = el(`
          <div class="cust-row" data-id="${escapeHtml(c.id)}">
            <div class="cust-row-main">
              <div class="cust-identity">
                <strong>${escapeHtml(identifier)}</strong>
                ${c.email && c.phone ? `<span class="muted">${escapeHtml(c.phone)}</span>` : ''}
              </div>
              <div class="cust-stats">
                <span class="tag">${stamps} stamp${stamps !== 1 ? 's' : ''}</span>
                ${totalRedeemed > 0 ? `<span class="tag tag-ok">${totalRedeemed} reward${totalRedeemed !== 1 ? 's' : ''}</span>` : ''}
                <span class="muted">last: ${escapeHtml(lastStamp)}</span>
              </div>
            </div>
            <div class="cust-joined muted">
              joined ${new Date(c.createdAt).toLocaleDateString()}
            </div>
          </div>
        `);
        row.addEventListener('click', () => void showDetail(c.id));
        listEl.append(row);
      }

      // Pager
      if (data.totalPages > 1) {
        pagerEl.style.display = '';
        pagerEl.replaceChildren();
        if (data.page > 1) {
          const prev = el('<button class="secondary" type="button">← Prev</button>');
          prev.addEventListener('click', () => {
            currentPage = data.page - 1;
            void renderList();
          });
          pagerEl.append(prev);
        }
        pagerEl.append(
          el(
            `<span class="muted">Page ${data.page} of ${data.totalPages}</span>`,
          ),
        );
        if (data.page < data.totalPages) {
          const next = el('<button class="secondary" type="button">Next →</button>');
          next.addEventListener('click', () => {
            currentPage = data.page + 1;
            void renderList();
          });
          pagerEl.append(next);
        }
      } else {
        pagerEl.style.display = 'none';
      }
    } catch (err) {
      errorEl.textContent = (err as Error).message;
      errorEl.style.display = '';
    }
  };

  const showDetail = async (customerId: string) => {
    detailSlot.replaceChildren(el('<div class="card"><p class="muted">Loading…</p></div>'));
    try {
      const c = await api<CustomerDetail>(
        `/businesses/me/customers/${customerId}`,
      );

      const identifier = c.email || c.phone || 'Unknown';
      const stampRows = c.card.stampEvents
        .map(
          (e) => `
          <div class="cust-event">
            <div>
              <span class="tag">${escapeHtml(SOURCE_LABELS[e.source] ?? e.source)}</span>
              ${e.orderId ? `<span class="muted">order ${escapeHtml(e.orderId)}</span>` : ''}
            </div>
            <span class="muted">${new Date(e.createdAt).toLocaleString()}</span>
          </div>
        `,
        )
        .join('');

      const rewardRows = c.card.rewards
        .map(
          (r) => `
          <div class="cust-event">
            <div>
              <span class="tag ${REWARD_STATUS_CLS[r.status] ?? ''}">${escapeHtml(r.status)}</span>
              <span>${escapeHtml(r.type)} — ${r.value}</span>
            </div>
            <span class="muted">
              created ${new Date(r.createdAt).toLocaleDateString()}
              ${r.redeemedAt ? ` · redeemed ${new Date(r.redeemedAt).toLocaleDateString()}` : ''}
              ${r.status === 'PENDING' ? ` · expires ${new Date(r.expiresAt).toLocaleDateString()}` : ''}
            </span>
          </div>
        `,
        )
        .join('');

      const detail = el(`
        <div class="card">
          <button class="secondary cust-back" type="button">← Back to list</button>
          <h2>${escapeHtml(identifier)}</h2>
          <div class="cust-detail-meta muted">
            ${c.email ? `email: ${escapeHtml(c.email)}` : ''}
            ${c.email && c.phone ? ' · ' : ''}
            ${c.phone ? `phone: ${escapeHtml(c.phone)}` : ''}
          </div>
          <div class="stat-grid" style="margin:16px 0">
            ${statTile(String(c.card.stamps), 'Current stamps').outerHTML}
            ${statTile(String(c.card.totalRedeemed), 'Rewards redeemed').outerHTML}
            ${statTile(
              c.card.lastStampAt
                ? new Date(c.card.lastStampAt).toLocaleDateString()
                : 'never',
              'Last stamp',
            ).outerHTML}
            ${statTile(
              new Date(c.card.joinedAt).toLocaleDateString(),
              'Joined',
            ).outerHTML}
          </div>

          <h3>Stamp history</h3>
          <div class="cust-events">
            ${stampRows || '<p class="muted">No stamps yet.</p>'}
          </div>

          <h3>Rewards</h3>
          <div class="cust-events">
            ${rewardRows || '<p class="muted">No rewards yet.</p>'}
          </div>
        </div>
      `);

      detail.querySelector<HTMLButtonElement>('.cust-back')!.addEventListener('click', () => {
        detailSlot.replaceChildren();
      });

      detailSlot.replaceChildren(detail);
    } catch (err) {
      detailSlot.replaceChildren(
        el(`<div class="card"><p class="msg-error">${escapeHtml((err as Error).message)}</p></div>`),
      );
    }
  };

  const scheduleSearch = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentPage = 1;
      void renderList();
    }, 300);
  };

  qInput.addEventListener('input', scheduleSearch);
  sortSelect.addEventListener('change', () => {
    currentPage = 1;
    void renderList();
  });

  // Add customer form
  const addForm = view.querySelector<HTMLFormElement>('#cust-add-form')!;
  const addError = view.querySelector<HTMLElement>('#cust-add-error')!;
  const addOk = view.querySelector<HTMLElement>('#cust-add-ok')!;

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    addError.style.display = 'none';
    addOk.style.display = 'none';

    const email = view.querySelector<HTMLInputElement>('#cust-add-email')!.value.trim();
    const phone = view.querySelector<HTMLInputElement>('#cust-add-phone')!.value.trim();

    if (!email && !phone) {
      addError.textContent = 'Enter an email or phone number.';
      addError.style.display = '';
      return;
    }

    try {
      await api('/businesses/me/customers', {
        method: 'POST',
        body: { email: email || undefined, phone: phone || undefined },
      });
      view.querySelector<HTMLInputElement>('#cust-add-email')!.value = '';
      view.querySelector<HTMLInputElement>('#cust-add-phone')!.value = '';
      addOk.textContent = 'Customer added.';
      addOk.style.display = '';
      void renderList();
    } catch (err) {
      addError.textContent = (err as Error).message;
      addError.style.display = '';
    }
  });

  void renderList();

  return { destroy: () => view.remove() };
}
