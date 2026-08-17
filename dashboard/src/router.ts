import { isAuthed } from './api';

export type Route =
  | 'login'
  | 'overview'
  | 'customers'
  | 'checkin'
  | 'integrate'
  | 'webhooks'
  | 'analytics'
  | 'audit'
  | 'settings';

const ROUTES: Route[] = ['login', 'overview', 'customers', 'checkin', 'integrate', 'webhooks', 'analytics', 'audit', 'settings'];

export function currentRoute(): Route {
  let route = location.hash.replace(/^#\//, '') as Route;
  if (!ROUTES.includes(route)) route = 'overview';
  if (!isAuthed()) return 'login';
  return route;
}

export function navigate(route: Route): void {
  location.hash = `#/${route}`;
}