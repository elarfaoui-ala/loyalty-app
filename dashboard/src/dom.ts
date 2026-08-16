export function el(html: string): HTMLElement {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild as HTMLElement;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}