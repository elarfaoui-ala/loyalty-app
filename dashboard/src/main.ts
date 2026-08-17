import './styles.css';
import { isAuthed, logout } from './api';
import { currentRoute, navigate, Route } from './router';
import { el } from './dom';
import { icons } from './icons';
import { renderLogin } from './views/login';
import { renderOverview } from './views/overview';
import { renderCheckin } from './views/checkin';
import { renderIntegrate } from './views/integrate';
import { renderSettings } from './views/settings';
import { renderWebhooks } from './views/webhooks';
import { renderCustomers } from './views/customers';
import { renderAudit } from './views/audit';
import { renderAnalytics } from './views/analytics';

interface ViewHandle {
  destroy?: () => void;
}

const app = document.getElementById('app')!;
let active: ViewHandle = {};

const NAV: Array<{ route: Route; label: string; icon: string }> = [
  { route: 'overview', label: 'Overview', icon: icons.overview },
  { route: 'customers', label: 'Customers', icon: icons.customers },
  { route: 'checkin', label: 'Check-in', icon: icons.checkin },
  { route: 'integrate', label: 'Integrate', icon: icons.integrate },
  { route: 'webhooks', label: 'Webhooks', icon: icons.webhooks },
  { route: 'analytics', label: 'Analytics', icon: icons.barChart },
  { route: 'audit', label: 'Audit', icon: icons.audit },
  { route: 'settings', label: 'Settings', icon: icons.settings },
];

function renderNav(route: Route): HTMLElement | null {
  if (route === 'login') return null;

  const navLinks = NAV.map(
    (item) =>
      `<a href="#/${item.route}" class="sidebar-link${item.route === route ? ' active' : ''}">${item.icon}<span>${item.label}</span></a>`,
  ).join('');

  const layout = el(`
    <div class="layout">
      <button class="nav-toggle" aria-label="Toggle navigation">${icons.menu}</button>
      <div class="sidebar-overlay"></div>
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="sidebar-brand-icon">L</div>
          <span class="sidebar-brand-text">Loyalty</span>
        </div>
        <nav class="sidebar-nav">${navLinks}</nav>
        <div class="sidebar-footer">
          <button class="logout-btn">${icons.logout}<span>Sign out</span></button>
        </div>
      </aside>
      <main class="main fade-in"></main>
    </div>
  `);

  layout.querySelector('.logout-btn')!.addEventListener('click', () => {
    void logout().then(() => navigate('login'));
  });

  const toggle = layout.querySelector('.nav-toggle')!;
  const sidebar = layout.querySelector('.sidebar')!;
  const overlay = layout.querySelector('.sidebar-overlay')!;

  const closeSidebar = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  };

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
  });

  overlay.addEventListener('click', closeSidebar);

  sidebar.querySelectorAll('.sidebar-link').forEach((link) => {
    link.addEventListener('click', closeSidebar);
  });

  return layout;
}

function render() {
  active.destroy?.();
  const route = currentRoute();

  if (route === 'login') {
    active = renderLogin(app);
    return;
  }

  const layout = renderNav(route);
  if (!layout) return;
  app.replaceChildren(layout);

  const main = app.querySelector('main')!;
  if (route === 'overview') active = renderOverview(main);
  else if (route === 'customers') active = renderCustomers(main);
  else if (route === 'checkin') active = renderCheckin(main);
  else if (route === 'integrate') active = renderIntegrate(main);
  else if (route === 'webhooks') active = renderWebhooks(main);
  else if (route === 'analytics') active = renderAnalytics(main);
  else if (route === 'audit') active = renderAudit(main);
  else if (route === 'settings') active = renderSettings(main);
}

window.addEventListener('hashchange', () => {
  if (isAuthed()) render();
  else navigate('login');
});
window.addEventListener('load', render);
render();
