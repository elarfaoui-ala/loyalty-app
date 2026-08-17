import { BusinessMe, Stats, setOnboardingStep } from '../api';
import { el, escapeHtml } from '../dom';
import { icons } from '../icons';

const STEPS: Array<{
  key: string;
  title: string;
  desc: string;
  href: string;
  auto: (b: BusinessMe, s: Stats) => boolean;
}> = [
  {
    key: 'rules',
    title: 'Set up your rewards',
    desc: 'Pick how many stamps earn a reward, and what the reward is.',
    href: 'settings',
    auto: () => false,
  },
  {
    key: 'embed',
    title: 'Add the widget to your site',
    desc: 'Copy one script tag and paste it into your website.',
    href: 'integrate',
    auto: () => false,
  },
  {
    key: 'api',
    title: 'Connect your POS',
    desc: 'Generate a server-to-server API key so orders stamp automatically.',
    href: 'settings',
    auto: (b) => b.hasApiKey,
  },
  {
    key: 'stamp',
    title: 'Earn your first stamp',
    desc: 'Open the Check-in screen and scan the QR from a customer phone.',
    href: 'checkin',
    auto: (_b, s) => s.totalStamps > 0,
  },
];

export function isDone(stepIndex: number, b: BusinessMe, s: Stats): boolean {
  return b.onboardingStep > stepIndex || STEPS[stepIndex].auto(b, s);
}

/**
 * Renders the "Get started" checklist. Steps complete automatically when
 * their condition is met (API key exists, first stamp earned); the current
 * step has a "Mark as done" button that advances onboardingStep.
 */
export function renderOnboarding(business: BusinessMe, stats: Stats): HTMLElement {
  const allDone = STEPS.every((_, i) => isDone(i, business, stats));
  const current = STEPS.findIndex((_, i) => !isDone(i, business, stats));

  const wrap = el('<div class="onboard"></div>');
  const render = () => {
    wrap.replaceChildren();

    if (allDone) {
      wrap.append(
        el(`
          <div class="card onboard-done">
            <h2>You're all set 🎉</h2>
            <p class="muted">
              Your loyalty program is live. Send customers to your site — the widget
              handles sign-in, check-in and rewards automatically.
            </p>
            <a class="onboard-cta" href="#/checkin">Open the check-in screen</a>
          </div>
        `),
      );
      return;
    }

    const card = el(`<div class="card onboard-checklist">
      <h2>Get started</h2>
      <p class="muted">${STEPS.length} quick steps to launch your loyalty program.</p>
    </div>`);

    STEPS.forEach((step, i) => {
      const done = isDone(i, business, stats);
      const row = el(`
        <div class="onboard-step ${done ? 'done' : ''} ${i === current ? 'active' : ''}">
          <span class="onboard-badge">${done ? '✓' : String(i + 1)}</span>
          <div class="onboard-body">
            <strong>${escapeHtml(step.title)}</strong>
            <p class="muted">${escapeHtml(step.desc)}</p>
          </div>
          ${done ? '' : `<a class="onboard-open" href="#/${step.href}">Open</a>`}
          ${i === current ? '<button class="onboard-next" type="button">Mark as done</button>' : ''}
        </div>
      `);
      const nextBtn = row.querySelector<HTMLButtonElement>('.onboard-next');
      nextBtn?.addEventListener('click', async () => {
        try {
          await setOnboardingStep(i + 1);
          business.onboardingStep = i + 1;
          render();
        } catch (err) {
          // Surface non-network errors to the owner, keep the checklist usable.
          const msg = (err as Error).message;
          if (msg) window.alert(msg);
        }
      });
      card.append(row);
    });

    wrap.append(card);
  };

  render();
  return wrap;
}
