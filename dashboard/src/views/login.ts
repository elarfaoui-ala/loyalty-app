import { authApi, storeTokens } from '../api';
import { el } from '../dom';
import { icons } from '../icons';
import { navigate } from '../router';

export function renderLogin(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div class="auth-wrap fade-in">
      <div class="auth-header">
        <div class="auth-logo">L</div>
        <h1>Loyalty Dashboard</h1>
        <p class="muted">Manage your loyalty card program.</p>
      </div>
      <div class="tabs">
        <button data-tab="login" class="active">Sign in</button>
        <button data-tab="register">Create account</button>
      </div>
      <form>
        <label for="auth-name">Business name</label>
        <input id="auth-name" type="text" placeholder="Ala's Diner" style="display:none" />
        <label for="auth-email">Email</label>
        <input id="auth-email" type="email" placeholder="owner@diner.com" required />
        <label for="auth-password">Password</label>
        <input id="auth-password" type="password" placeholder="••••••••" minlength="8" required />
        <div class="msg-error" style="display:none"></div>
        <button class="primary" type="submit" style="width:100%;margin-top:20px">Continue</button>
      </form>
    </div>
  `);

  const form = view.querySelector('form')!;
  const nameInput = view.querySelector<HTMLInputElement>('#auth-name')!;
  const emailInput = view.querySelector<HTMLInputElement>('#auth-email')!;
  const passwordInput = view.querySelector<HTMLInputElement>('#auth-password')!;
  const errorBox = view.querySelector<HTMLElement>('.msg-error')!;
  const tabs = view.querySelectorAll('.tabs button');

  let mode: 'login' | 'register' = 'login';

  const setMode = (next: 'login' | 'register') => {
    mode = next;
    tabs.forEach((tab) => {
      const active = tab.getAttribute('data-tab') === next;
      tab.classList.toggle('active', active);
    });
    nameInput.style.display = next === 'register' ? '' : 'none';
  };

  tabs.forEach((tab) =>
    tab.addEventListener('click', () =>
      setMode(tab.getAttribute('data-tab') as 'login' | 'register'),
    ),
  );

  const showError = (message: string) => {
    errorBox.textContent = message;
    errorBox.style.display = '';
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';
    try {
      if (mode === 'register') {
        if (!nameInput.value.trim()) return showError('Business name is required');
        const result = await authApi.register({
          name: nameInput.value.trim(),
          email: emailInput.value.trim(),
          password: passwordInput.value,
        });
        alert(
          `Your server-to-server API key (shown once, store it safely):\n\n${result.apiKey}`,
        );
        storeTokens(result.accessToken, result.refreshToken);
      } else {
        const result = await authApi.login(emailInput.value.trim(), passwordInput.value);
        storeTokens(result.accessToken, result.refreshToken);
      }
      navigate('overview');
    } catch (err) {
      showError((err as Error).message);
    }
  });

  app.replaceChildren(view);
  return { destroy: () => view.remove() };
}
