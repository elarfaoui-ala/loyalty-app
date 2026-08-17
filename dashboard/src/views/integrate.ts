import { api, BusinessMe, setOnboardingStep } from '../api';
import { el, escapeHtml } from '../dom';
import { icons } from '../icons';

const WIDGET_CDN = 'https://cdn.yourloyaltyapp.com/widget.js';

type Theme = 'light' | 'dark';
type Position = 'bottom-right' | 'bottom-left';
type Trigger = 'auto' | 'manual';

export function renderIntegrate(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div>
      <div class="page-header">
        <h1>${icons.integrate} Integrate the widget</h1>
        <p>
          Add the loyalty widget to your website in under a minute. Configure the look,
          copy the snippet, and paste it into your page just before the closing
          <code>&lt;/body&gt;</code> tag.
        </p>
      </div>

      <div class="card">
        <h2>Widget options</h2>
        <div class="opt-grid">
          <div>
            <label for="i-theme">Theme</label>
            <select id="i-theme">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div>
            <label for="i-position">Launcher position</label>
            <select id="i-position">
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
            </select>
          </div>
          <div>
            <label for="i-trigger">Open trigger</label>
            <select id="i-trigger">
              <option value="auto">Launcher button</option>
              <option value="manual">Custom button (manual)</option>
            </select>
          </div>
        </div>
        <label for="i-cdn">Widget script URL</label>
        <input id="i-cdn" type="url" value="${WIDGET_CDN}" />
        <label class="check-row">
          <input id="i-verbose" type="checkbox" checked />
          Include <code>data-api-base</code> (self-hosted / local API)
        </label>
        <div class="msg-error" style="display:none"></div>
      </div>

      <div class="card">
        <h2>Embed snippet</h2>
        <p class="muted">Copy this into your website's HTML:</p>
        <div class="snippet"><pre id="snippet-script"></pre></div>
        <button class="primary" id="copy-script" type="button">Copy snippet</button>
        <div class="snippet-alt" id="manual-block" style="display:none">
          <h3>Open from your own button</h3>
          <p class="muted">Use this to trigger the widget from any element:</p>
          <div class="snippet"><pre id="snippet-manual"></pre></div>
          <button class="secondary" id="copy-manual" type="button">Copy</button>
        </div>
        <div class="snippet-alt">
          <h3>Inline / bundler usage</h3>
          <p class="muted">
            Prefer placing the widget directly in markup, or bundling it into your app?
            Use the element instead of the loader script:
          </p>
          <div class="snippet"><pre id="snippet-inline"></pre></div>
          <button class="secondary" id="copy-inline" type="button">Copy</button>
        </div>
      </div>

      <div class="card">
        <h2>Preview</h2>
        <p class="muted">How the widget will look on your site.</p>
        <div id="preview-slot"></div>
      </div>
    </div>
  `);
  app.replaceChildren(view);

  const themeSel = view.querySelector<HTMLSelectElement>('#i-theme')!;
  const positionSel = view.querySelector<HTMLSelectElement>('#i-position')!;
  const triggerSel = view.querySelector<HTMLSelectElement>('#i-trigger')!;
  const cdnInput = view.querySelector<HTMLInputElement>('#i-cdn')!;
  const verbose = view.querySelector<HTMLInputElement>('#i-verbose')!;
  const scriptPre = view.querySelector<HTMLElement>('#snippet-script')!;
  const manualBlock = view.querySelector<HTMLElement>('#manual-block')!;
  const manualPre = view.querySelector<HTMLElement>('#snippet-manual')!;
  const inlinePre = view.querySelector<HTMLElement>('#snippet-inline')!;
  const previewSlot = view.querySelector('#preview-slot')!;
  const errorBox = view.querySelector<HTMLElement>('.msg-error')!;

  let business: BusinessMe | null = null;

  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

  const readOptions = () => ({
    theme: themeSel.value as Theme,
    position: positionSel.value as Position,
    trigger: triggerSel.value as Trigger,
    cdn: cdnInput.value.trim() || WIDGET_CDN,
    includeBase: verbose.checked && apiBase.length > 0,
  });

  const scriptSnippet = () => {
    const o = readOptions();
    const attrs = [`src="${escapeHtml(o.cdn)}"`, `data-business-id="${escapeHtml(business?.slug ?? '')}"`];
    if (o.includeBase) attrs.push(`data-api-base="${escapeHtml(apiBase)}"`);
    if (o.theme === 'dark') attrs.push('data-theme="dark"');
    if (o.position === 'bottom-left') attrs.push('data-position="bottom-left"');
    if (o.trigger === 'manual') attrs.push('data-trigger="manual"');
    attrs.push('async');
    return `<script\n  ${attrs.join('\n  ')}\n></script>`;
  };

  const manualSnippet = () =>
    `<button onclick="window.LoyaltyWidget && window.LoyaltyWidget.open()">\n  My rewards\n</button>`;

  const inlineSnippet = () => {
    const o = readOptions();
    const attrs = [`business-id="${escapeHtml(business?.slug ?? '')}"`];
    if (o.includeBase) attrs.push(`api-base="${escapeHtml(apiBase)}"`);
    if (o.theme === 'dark') attrs.push('theme="dark"');
    attrs.push('inline');
    return `<loyalty-widget\n  ${attrs.join('\n  ')}\n></loyalty-widget>`;
  };

  const render = () => {
    scriptPre.textContent = scriptSnippet();
    manualPre.textContent = manualSnippet();
    inlinePre.textContent = inlineSnippet();
    manualBlock.style.display = readOptions().trigger === 'manual' ? '' : 'none';
    previewSlot.replaceChildren(business ? renderPreview(business, readOptions().theme) : el('<p class="muted">Loading…</p>'));
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    }
  };

  const copyWithFeedback = async (button: HTMLButtonElement, text: string, advanceStep?: number) => {
    const original = button.textContent;
    const ok = await copy(text);
    button.textContent = ok ? 'Copied!' : 'Copy failed — select the code and copy manually';
    button.disabled = true;
    window.setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1600);
    // Copying the embed marks the "Add the widget" step done — but only when
    // the owner already completed reward setup, so the checklist order holds.
    if (ok && advanceStep !== undefined && business && business.onboardingStep >= 1) {
      const next = Math.max(business.onboardingStep, advanceStep);
      try {
        await setOnboardingStep(next);
        business.onboardingStep = next;
      } catch {
        // non-critical; the snippet still copied
      }
    }
  };

  view.querySelector<HTMLButtonElement>('#copy-script')!.addEventListener('click', (e) => {
    void copyWithFeedback(e.currentTarget as HTMLButtonElement, scriptSnippet(), 2);
  });
  view.querySelector<HTMLButtonElement>('#copy-manual')!.addEventListener('click', (e) => {
    void copyWithFeedback(e.currentTarget as HTMLButtonElement, manualSnippet(), 2);
  });
  view.querySelector<HTMLButtonElement>('#copy-inline')!.addEventListener('click', (e) => {
    void copyWithFeedback(e.currentTarget as HTMLButtonElement, inlineSnippet(), 2);
  });

  [themeSel, positionSel, triggerSel, cdnInput, verbose].forEach((ctrl) =>
    ctrl.addEventListener('input', render),
  );

  api<BusinessMe>('/businesses/me')
    .then((b) => {
      business = b;
      render();
    })
    .catch((err: Error) => {
      errorBox.textContent = err.message;
      errorBox.style.display = '';
    });

  return { destroy: () => view.remove() };
}

/** Static preview mirroring the widget's visual design. */
export function renderPreview(business: BusinessMe, theme: Theme): HTMLElement {
  const pct = Math.min(
    100,
    ((business.stampThreshold - 1) / business.stampThreshold) * 100,
  );
  const panel = el(`
    <div class="wpreview ${theme === 'dark' ? 'dark' : ''}" style="--wbrand:${escapeHtml(business.brandColor)}">
      <div class="wp-header">${escapeHtml(business.name)}</div>
      <div class="wp-body">
        <button class="wp-checkin" type="button">Check in</button>
        <p class="wp-muted">${business.stampThreshold - 1} / ${business.stampThreshold} visits toward your next reward</p>
        <div class="wp-track"><div class="wp-fill" style="width:${pct}%"></div></div>
        <div class="wp-stamps">${Array.from({ length: business.stampThreshold }, (_, i) => `<span class="${i < business.stampThreshold - 1 ? 'earned' : ''}"></span>`).join('')}</div>
        <div class="wp-reward">
          <strong>${formatReward(business.rewardType, business.rewardValue)}</strong>
          <div class="wp-muted">Expires ${new Date(Date.now() + business.rewardExpiryDays * 86400000).toLocaleDateString()}</div>
          <button class="wp-redeem" type="button">Redeem now</button>
        </div>
      </div>
    </div>
  `);
  return panel;
}

function formatReward(type: BusinessMe['rewardType'], value: number): string {
  if (type === 'PERCENT_OFF') return `${value}% off your next order`;
  if (type === 'FIXED_OFF') return `${value} off your next order`;
  return 'Free item unlocked';
}
