import './styles.css';
import { isAuthed, logout } from './api';
import { currentRoute, navigate, Route } from './router';
import { el } from './dom';
import { renderLogin } from './views/login';
import { renderOverview } from './views/overview';
import { renderCheckin } from './views/checkin';
import { renderIntegrate } from './views/integrate';
import { renderSettings } from './views/settings';
import { renderWebhooks } from './views/webhooks';
import { renderCustomers } from './views/customers';
import { renderAudit } from './views/audit';

interface ViewHandle {
  destroy?: () => void;
}

const app = document.getElementById('app')!;
let active: ViewHandle = {};

const NAV: Array<{ route: Route; label: string }> = [
  { route: 'overview', label: 'Overview' },
  { route: 'customers', label: 'Customers' },
  { route: 'checkin', label: 'Check-in' },
  { route: 'integrate', label: 'Integrate' },
  { route: 'webhooks', label: 'Webhooks' },
  { route: 'audit', label: 'Audit' },
  { route: 'settings', label: 'Settings' },
];

function renderNav(route: Route): HTMLElement | null {
  if (route === 'login') return null;
  const nav = el(`
    <nav class="topbar">
      <span class="brand">Loyalty</span>
      <div class="links"></div>
      <span class="spacer"></span>
      <button class="logout">Sign out</button>
    </nav>
  `);
  const links = nav.querySelector('.links')!;
  for (const item of NAV) {
    const a = document.createElement('a');
    a.href = `#/${item.route}`;
    a.textContent = item.label;
    a.classList.toggle('active', item.route === route);
    links.append(a);
  }
  nav.querySelector('.logout')!.addEventListener('click', () => {
    void logout().then(() => navigate('login'));
  });
  return nav;
}

function render() {
  active.destroy?.();
  const route = currentRoute();

  if (route === 'login') {
    active = renderLogin(app);
    return;
  }

  app.replaceChildren(renderNav(route)!, el('<main></main>'));
  const main = app.querySelector('main')!;

  if (route === 'overview') active = renderOverview(main);
  else if (route === 'customers') active = renderCustomers(main);
  else if (route === 'checkin') active = renderCheckin(main);
  else if (route === 'integrate') active = renderIntegrate(main);
  else if (route === 'webhooks') active = renderWebhooks(main);
  else if (route === 'audit') active = renderAudit(main);
  else if (route === 'settings') active = renderSettings(main);
}

window.addEventListener('hashchange', () => {
  if (isAuthed()) render();
  else navigate('login');
});
window.addEventListener('load', render);
render();