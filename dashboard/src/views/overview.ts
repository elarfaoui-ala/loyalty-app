import { api, BusinessMe, Stats } from '../api';
import { el } from '../dom';
import { icons } from '../icons';
import { renderOnboarding } from './onboarding';

export function renderOverview(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div>
      <div class="page-header">
        <h1>Overview</h1>
        <p>Your loyalty program at a glance.</p>
      </div>
      <div id="onboarding-slot"></div>
      <div class="card">
        <div class="stat-grid" id="stat-grid">
          <div class="stat stat-primary"><div class="stat-icon">${icons.users}</div><div class="value">…</div><div class="label">Loyalty cards</div></div>
          <div class="stat stat-success"><div class="stat-icon">${icons.star}</div><div class="value">…</div><div class="label">Stamps given</div></div>
          <div class="stat stat-warning"><div class="stat-icon">${icons.gift}</div><div class="value">…</div><div class="label">Rewards pending</div></div>
          <div class="stat stat-info"><div class="stat-icon">${icons.activity}</div><div class="value">…</div><div class="label">Rewards redeemed</div></div>
        </div>
      </div>
    </div>
  `);
  app.replaceChildren(view);

  const grid = view.querySelector('#stat-grid')!;
  const onboardingSlot = view.querySelector('#onboarding-slot')!;

  const renderStats = (stats: Stats) => {
    const cards = grid.children;
    (cards[0].querySelector('.value')!).textContent = String(stats.totalCards);
    (cards[1].querySelector('.value')!).textContent = String(stats.totalStamps);
    (cards[2].querySelector('.value')!).textContent = String(stats.pendingRewards);
    (cards[3].querySelector('.value')!).textContent = String(stats.redeemedRewards);
  };

  const load = async () => {
    try {
      const [business, stats] = await Promise.all([
        api<BusinessMe>('/businesses/me'),
        api<Stats>('/businesses/me/stats'),
      ]);
      renderStats(stats);
      onboardingSlot.replaceChildren(renderOnboarding(business, stats));
    } catch {
      // Stats will show as "…" if the request fails
    }
  };

  void load();

  return { destroy: () => view.remove() };
}
