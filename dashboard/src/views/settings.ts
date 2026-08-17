import { api, BusinessMe, storeTokens, setOnboardingStep } from '../api';
import { el, escapeHtml } from '../dom';
import { icons } from '../icons';
import { renderPreview } from './integrate';

type UpdatePayload = Partial<{
  name: string;
  stampThreshold: number;
  rewardType: BusinessMe['rewardType'];
  rewardValue: number;
  rewardExpiryDays: number;
  stampCooldownSec: number;
  brandColor: string;
  logoUrl: string;
}>;

export function renderSettings(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div>
      <div class="page-header">
        <h1>Settings</h1>
        <p>Configure your loyalty program rules and branding.</p>
      </div>

      <div class="card">
        <h2>${icons.gift} Reward rules</h2>
        <form id="rules-form">
          <label for="s-name">Business name</label>
          <input id="s-name" type="text" />
          <label for="s-threshold">Stamps to earn a reward</label>
          <input id="s-threshold" type="number" min="1" max="100" />
          <label for="s-type">Reward type</label>
          <select id="s-type">
            <option value="PERCENT_OFF">Percent off</option>
            <option value="FIXED_OFF">Fixed amount off</option>
            <option value="FREE_ITEM">Free item</option>
          </select>
          <label for="s-value">Reward value</label>
          <input id="s-value" type="number" min="1" />
          <label for="s-expiry">Reward valid for (days)</label>
          <input id="s-expiry" type="number" min="1" />
          <label for="s-cooldown">Minimum seconds between stamps</label>
          <input id="s-cooldown" type="number" min="0" />
          <label for="s-color">Widget accent color</label>
          <input id="s-color" type="color" />
          <label for="s-logo">Logo URL</label>
          <input id="s-logo" type="url" placeholder="https://…" />
          <div class="msg-error" style="display:none"></div>
          <div class="msg-ok" style="display:none"></div>
          <button class="primary" type="submit">Save changes</button>
        </form>
      </div>

      <div class="card">
        <h2>${icons.eye} Widget preview</h2>
        <p class="muted">Preview the accent color and theme your customers will see.</p>
        <div class="opt-grid">
          <div>
            <label for="p-theme">Theme</label>
            <select id="p-theme">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div>
            <label for="p-color">Accent color</label>
            <input id="p-color" type="color" />
          </div>
        </div>
        <div id="p-preview"></div>
      </div>

      <div class="card">
        <h2>${icons.shield} Server-to-server API key</h2>
        <p class="muted" id="key-note"></p>
        <div id="key-area"></div>
        <button class="secondary" id="rotate-key">${icons.refresh} Rotate API key</button>
      </div>

      <div class="card">
        <h2>${icons.shield} Change password</h2>
        <form id="password-form">
          <label for="s-current-password">Current password</label>
          <input id="s-current-password" type="password" required />
          <label for="s-new-password">New password</label>
          <input id="s-new-password" type="password" minlength="8" required />
          <p class="muted" style="margin-top:8px">
            Changing the password signs out every other session. This session stays active.
          </p>
          <div class="msg-error" style="display:none"></div>
          <div class="msg-ok" style="display:none"></div>
          <button class="primary" type="submit">Change password</button>
        </form>
      </div>
    </div>
  `);
  app.replaceChildren(view);

  const form = view.querySelector<HTMLFormElement>('#rules-form')!;
  const errorBox = view.querySelector<HTMLElement>('.msg-error')!;
  const okBox = view.querySelector<HTMLElement>('.msg-ok')!;
  const keyNote = view.querySelector('#key-note')!;
  const keyArea = view.querySelector('#key-area')!;

  const showError = (message: string) => {
    okBox.style.display = 'none';
    errorBox.textContent = message;
    errorBox.style.display = '';
  };
  const showOk = (message: string) => {
    errorBox.style.display = 'none';
    okBox.textContent = message;
    okBox.style.display = '';
  };

  api<BusinessMe>('/businesses/me')
    .then((business) => {
      (view.querySelector<HTMLInputElement>('#s-name')!).value = business.name;
      (view.querySelector<HTMLInputElement>('#s-threshold')!).value = String(
        business.stampThreshold,
      );
      (view.querySelector<HTMLSelectElement>('#s-type')!).value = business.rewardType;
      (view.querySelector<HTMLInputElement>('#s-value')!).value = String(business.rewardValue);
      (view.querySelector<HTMLInputElement>('#s-expiry')!).value = String(
        business.rewardExpiryDays,
      );
      (view.querySelector<HTMLInputElement>('#s-cooldown')!).value = String(
        business.stampCooldownSec,
      );
      (view.querySelector<HTMLInputElement>('#s-color')!).value = business.brandColor;
      (view.querySelector<HTMLInputElement>('#s-logo')!).value = business.logoUrl ?? '';

      keyNote.textContent = business.hasApiKey
        ? `Active key starts with: ${business.apiKeyPrefix}`.trim()
        : 'No API key generated yet — create one below.';
      renderKeyArea('unset');

      const pTheme = view.querySelector<HTMLSelectElement>('#p-theme')!;
      const pColor = view.querySelector<HTMLInputElement>('#p-color')!;
      const pPreview = view.querySelector('#p-preview')!;
      const paintPreview = () => {
        const themed = { ...business, brandColor: pColor.value };
        pPreview.replaceChildren(renderPreview(themed, pTheme.value as 'light' | 'dark'));
      };
      pTheme.addEventListener('input', paintPreview);
      pColor.addEventListener('input', paintPreview);
      paintPreview();
    })
    .catch((err: Error) => showError(err.message));

  const renderKeyArea = (mode: 'unset' | 'rotating' | 'shown' | 'hidden', key?: string) => {
    keyArea.replaceChildren();
    if (mode === 'shown' && key) {
      const note = el('<p class="muted" style="margin-top:8px"></p>');
      note.textContent =
        'This is the ONLY time this key is shown. Store it somewhere safe — it replaces the previous key immediately.';
      keyArea.append(
        el(`<pre class="api-key">${escapeHtml(key)}</pre>`),
        note,
      );
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = (id: string) => view.querySelector<HTMLInputElement>(id)!;
    const payload: UpdatePayload = {
      name: input('#s-name').value.trim() || undefined,
      stampThreshold: Number(input('#s-threshold').value),
      rewardType: input('#s-type').value as BusinessMe['rewardType'],
      rewardValue: Number(input('#s-value').value),
      rewardExpiryDays: Number(input('#s-expiry').value),
      stampCooldownSec: Number(input('#s-cooldown').value),
      brandColor: input('#s-color').value,
      logoUrl: input('#s-logo').value || undefined,
    };
    Object.keys(payload).forEach((key) => {
      const value = (payload as Record<string, unknown>)[key];
      if (value === undefined) delete (payload as Record<string, unknown>)[key];
    });
    try {
      await api<BusinessMe>('/businesses/me', { method: 'PATCH', body: payload });
      try {
        const b = await api<BusinessMe>('/businesses/me');
        if (b.onboardingStep < 1) {
          await setOnboardingStep(1);
        }
      } catch {
        // non-critical
      }
      showOk('Settings saved');
    } catch (err) {
      showError((err as Error).message);
    }
  });

  view.querySelector('#rotate-key')!.addEventListener('click', async () => {
    const confirmed = window.confirm(
      'Rotating the API key immediately invalidates the current one used by your POS/checkout. Continue?',
    );
    if (!confirmed) return;
    try {
      const result = await api<{ apiKey: string }>('/businesses/me/api-keys/rotate', {
        method: 'POST',
      });
      renderKeyArea('shown', result.apiKey);
      keyNote.textContent = 'Key rotated successfully.';
    } catch (err) {
      showError((err as Error).message);
    }
  });

  const passwordForm = view.querySelector<HTMLFormElement>('#password-form')!;
  const passwordError = view.querySelector<HTMLElement>('#password-form .msg-error')!;
  const passwordOk = view.querySelector<HTMLElement>('#password-form .msg-ok')!;
  passwordForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    passwordOk.style.display = 'none';
    passwordError.style.display = 'none';
    const current = view.querySelector<HTMLInputElement>('#s-current-password')!.value;
    const next = view.querySelector<HTMLInputElement>('#s-new-password')!.value;
    try {
      const result = await api<{
        changed: boolean;
        accessToken: string;
        refreshToken: string;
      }>('/auth/business/change-password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      storeTokens(result.accessToken, result.refreshToken);
      view.querySelector<HTMLInputElement>('#s-current-password')!.value = '';
      view.querySelector<HTMLInputElement>('#s-new-password')!.value = '';
      passwordOk.textContent = 'Password changed. Other sessions were signed out.';
      passwordOk.style.display = '';
    } catch (err) {
      passwordError.textContent = (err as Error).message;
      passwordError.style.display = '';
    }
  });

  return { destroy: () => view.remove() };
}
