import { api } from '../api';
import { el, escapeHtml } from '../dom';
import { icons } from '../icons';

interface AuditEntry {
  id: string;
  action: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

interface AuditListResponse {
  items: AuditEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const ACTION_LABELS: Record<string, string> = {
  'settings.updated': 'Settings updated',
  'api_key.rotated': 'API key rotated',
  'webhook.created': 'Webhook created',
  'webhook.updated': 'Webhook updated',
  'webhook.deleted': 'Webhook deleted',
  'webhook.tested': 'Webhook tested',
  'webhook.delivery_redelivered': 'Delivery redelivered',
};

const ACTION_CLS: Record<string, string> = {
  'settings.updated': '',
  'api_key.rotated': 'tag-warn',
  'webhook.created': 'tag-ok',
  'webhook.updated': '',
  'webhook.deleted': 'tag-err',
  'webhook.tested': '',
  'webhook.delivery_redelivered': 'tag-warn',
};

export function renderAudit(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div>
      <div class="page-header">
        <h1>${icons.audit} Audit log</h1>
        <p>A record of changes made to your account and webhooks.</p>
      </div>

      <div class="card" id="audit-card">
        <div id="audit-list"><p class="muted">Loading…</p></div>
        <div id="audit-pager" style="display:none" class="cust-pager"></div>
      </div>
    </div>
  `);
  app.replaceChildren(view);

  const listEl = view.querySelector<HTMLElement>('#audit-list')!;
  const pagerEl = view.querySelector<HTMLElement>('#audit-pager')!;

  let currentPage = 1;

  const formatDetails = (details: Record<string, unknown> | null): string => {
    if (!details) return '';
    const parts: string[] = [];
    if (details.changed) {
      parts.push(`changed: ${escapeHtml((details.changed as string[]).join(', '))}`);
    }
    if (details.url) {
      parts.push(`url: ${escapeHtml(String(details.url))}`);
    }
    if (details.events) {
      parts.push(`events: ${escapeHtml((details.events as string[]).join(', '))}`);
    }
    if (details.endpointId) {
      parts.push(`endpoint: ${escapeHtml(String(details.endpointId).slice(0, 8))}…`);
    }
    if (details.deliveryId) {
      parts.push(`delivery: ${escapeHtml(String(details.deliveryId).slice(0, 8))}…`);
    }
    return parts.length > 0 ? `<span class="muted">${parts.join(' · ')}</span>` : '';
  };

  const renderList = async () => {
    listEl.replaceChildren(el('<p class="muted">Loading…</p>'));
    try {
      const data = await api<AuditListResponse>(
        `/businesses/me/audit?page=${currentPage}&limit=20`,
      );

      listEl.replaceChildren();
      if (data.items.length === 0) {
        listEl.append(
          el('<p class="muted">No audit entries yet. Changes to settings and webhooks will appear here.</p>'),
        );
        pagerEl.style.display = 'none';
        return;
      }

      for (const entry of data.items) {
        const label = ACTION_LABELS[entry.action] ?? entry.action;
        const cls = ACTION_CLS[entry.action] ?? '';
        const row = el(`
          <div class="audit-row">
            <div class="audit-main">
              <span class="tag ${cls}">${escapeHtml(label)}</span>
              ${formatDetails(entry.details)}
            </div>
            <span class="muted">${new Date(entry.createdAt).toLocaleString()}</span>
          </div>
        `);
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
          el(`<span class="muted">Page ${data.page} of ${data.totalPages}</span>`),
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
    } catch {
      listEl.replaceChildren(el('<p class="muted">Could not load audit log.</p>'));
    }
  };

  void renderList();

  return { destroy: () => view.remove() };
}
