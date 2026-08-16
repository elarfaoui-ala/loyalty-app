import { api, BusinessMe, Stats } from '../api';
import { el } from '../dom';
import { renderOnboarding } from './onboarding';

export function renderOverview(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div>
      <h1>Overview</h1>
      <div id="onboarding-slot"></div>
      <div class="card"><p class="muted" id="stat-note">Loading…</p>
        <div class="stat-grid" id="stat-grid"></div>
      </div>
    </div>
  `);
  app.replaceChildren(view);

  const grid = view.querySelector('#stat-grid')!;
  const note = view.querySelector('#stat-note')!;
  const onboardingSlot = view.querySelector('#onboarding-slot')!;

  const renderStats = (stats: Stats) => {
    note.textContent = '';
    grid.replaceChildren(
      statCard(stats.totalCards, 'Loyalty cards'),
      statCard(stats.totalStamps, 'Stamps given'),
      statCard(stats.pendingRewards, 'Rewards pending'),
      statCard(stats.redeemedRewards, 'Rewards redeemed'),
    );
  };

  const load = async () => {
    try {
      const [business, stats] = await Promise.all([
        api<BusinessMe>('/businesses/me'),
        api<Stats>('/businesses/me/stats'),
      ]);
      renderStats(stats);
      onboardingSlot.replaceChildren(renderOnboarding(business, stats));
    } catch (err) {
      note.textContent = (err as Error).message;
    }
  };

  void load();

  return { destroy: () => view.remove() };
}

function statCard(value: number, label: string): HTMLElement {
  const card = el('<div class="stat"></div>');
  const valueEl = document.createElement('div');
  valueEl.className = 'value';
  valueEl.textContent = String(value);
  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  labelEl.textContent = label;
  card.append(valueEl, labelEl);
  return card;
}
