import { api } from '../api';
import { el } from '../dom';
import { icons } from '../icons';

interface Overview {
  customers: number;
  stamps: { total: number; thisWeek: number; thisMonth: number; growth: number };
  rewards: { pending: number; redeemed: number; expired: number };
}

interface TrendDay {
  day: string;
  stamps: number;
  rewards: number;
  redemptions: number;
}

interface TopCustomer {
  id: string;
  email: string | null;
  phone: string | null;
  joinedAt: string;
  stamps: number;
  redeemed: number;
  lastStampAt: string | null;
}

const BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ??
  'http://localhost:3000/api/v1';

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function renderTrendChart(container: HTMLElement, data: TrendDay[], days: number) {
  const maxStamps = Math.max(1, ...data.map((d) => d.stamps));
  const maxRewards = Math.max(1, ...data.map((d) => d.rewards + d.redemptions));
  const max = Math.max(maxStamps, maxRewards);

  const bars = data
    .map((d) => {
      const stampH = Math.round((d.stamps / max) * 100);
      const rewardH = Math.round(((d.rewards + d.redemptions) / max) * 100);
      const label = d.day.slice(5);
      return `
        <div class="chart-bar-group">
          <div class="chart-bars">
            <div class="chart-bar chart-bar-stamps" style="height:${stampH}%" title="${d.stamps} stamps"></div>
            <div class="chart-bar chart-bar-rewards" style="height:${rewardH}%" title="${d.rewards + d.redemptions} rewards"></div>
          </div>
          <div class="chart-label">${label}</div>
        </div>`;
    })
    .join('');

  container.innerHTML = `
    <div class="chart-legend">
      <span class="legend-item"><span class="legend-dot legend-dot-stamps"></span>Stamps</span>
      <span class="legend-item"><span class="legend-dot legend-dot-rewards"></span>Rewards</span>
    </div>
    <div class="chart">${bars}</div>`;
}

export function renderAnalytics(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div>
      <div class="page-header">
        <h1>${icons.activity} Analytics</h1>
        <p>Track your loyalty program performance.</p>
      </div>

      <div class="card">
        <div class="stat-grid" id="a-overview">
          <div class="stat stat-primary"><div class="stat-icon">${icons.users}</div><div class="value">…</div><div class="label">Total customers</div></div>
          <div class="stat stat-success"><div class="stat-icon">${icons.star}</div><div class="value">…</div><div class="label">Total stamps</div></div>
          <div class="stat stat-warning"><div class="stat-icon">${icons.gift}</div><div class="value">…</div><div class="label">Pending rewards</div></div>
          <div class="stat stat-info"><div class="stat-icon">${icons.activity}</div><div class="value">…</div><div class="label">Redeemed rewards</div></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>${icons.activity} Stamps &amp; rewards trend</h2>
          <select id="a-trend-range" class="select-sm">
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30" selected>Last 30 days</option>
            <option value="60">Last 60 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        <div id="a-trend-chart" class="chart-wrap"></div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>${icons.users} Top customers</h2>
        </div>
        <div id="a-top-customers">
          <table class="data-table">
            <thead><tr><th>Customer</th><th>Visits</th><th>Rewards</th><th>Last visit</th></tr></thead>
            <tbody><tr><td colspan="4" class="muted" style="text-align:center">Loading…</td></tr></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h2>${icons.gift} Export data</h2>
        </div>
        <div class="export-row">
          <button class="secondary" id="a-export-stamps">${icons.download} Export stamps (CSV)</button>
          <button class="secondary" id="a-export-rewards">${icons.download} Export rewards (CSV)</button>
        </div>
      </div>
    </div>
  `);
  app.replaceChildren(view);

  const overviewGrid = view.querySelector('#a-overview')!;
  const trendChart = view.querySelector('#a-trend-chart') as HTMLElement;
  const trendRange = view.querySelector('#a-trend-range') as HTMLSelectElement;
  const topBody = view.querySelector('#a-top-customers tbody')!;
  const exportStamps = view.querySelector('#a-export-stamps') as HTMLButtonElement;
  const exportRewards = view.querySelector('#a-export-rewards') as HTMLButtonElement;

  const renderOverview = (data: Overview) => {
    const cards = overviewGrid.children;
    (cards[0].querySelector('.value')!).textContent = String(data.customers);
    (cards[1].querySelector('.value')!).textContent = String(data.stamps.total);
    (cards[2].querySelector('.value')!).textContent = String(data.rewards.pending);
    (cards[3].querySelector('.value')!).textContent = String(data.rewards.redeemed);
  };

  const renderTopCustomers = (customers: TopCustomer[]) => {
    if (!customers.length) {
      topBody.innerHTML = '<tr><td colspan="4" class="muted" style="text-align:center">No customers yet</td></tr>';
      return;
    }
    topBody.innerHTML = customers
      .map(
        (c) => `<tr>
          <td>${c.email ?? c.phone ?? c.id.slice(0, 8)}</td>
          <td>${c.stamps}</td>
          <td>${c.redeemed}</td>
          <td>${c.lastStampAt ? new Date(c.lastStampAt).toLocaleDateString() : '—'}</td>
        </tr>`,
      )
      .join('');
  };

  let trendDays = 30;

  const loadTrend = async () => {
    try {
      const data = await api<TrendDay[]>(`/businesses/me/analytics/trend?days=${trendDays}`);
      renderTrendChart(trendChart, data, trendDays);
    } catch {
      trendChart.innerHTML = '<p class="muted" style="text-align:center">Could not load trend data</p>';
    }
  };

  const load = async () => {
    try {
      const [overview, topCustomers] = await Promise.all([
        api<Overview>('/businesses/me/analytics/overview'),
        api<TopCustomer[]>('/businesses/me/analytics/top-customers?limit=10'),
      ]);
      renderOverview(overview);
      renderTopCustomers(topCustomers);
    } catch {
      // Stats will show as "…" if the request fails
    }
    await loadTrend();
  };

  trendRange.addEventListener('change', () => {
    trendDays = Number(trendRange.value);
    void loadTrend();
  });

  exportStamps.addEventListener('click', async () => {
    try {
      const res = await fetch(`${BASE}/businesses/me/analytics/export/stamps`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('loyalty_access_token')}` },
      });
      const blob = await res.blob();
      downloadBlob('stamps.csv', blob);
    } catch {
      // silent
    }
  });

  exportRewards.addEventListener('click', async () => {
    try {
      const res = await fetch(`${BASE}/businesses/me/analytics/export/rewards`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('loyalty_access_token')}` },
      });
      const blob = await res.blob();
      downloadBlob('rewards.csv', blob);
    } catch {
      // silent
    }
  });

  void load();

  return { destroy: () => view.remove() };
}
