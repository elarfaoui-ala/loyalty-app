import './loyalty-widget-element';

/**
 * Auto-mount: when loaded via a plain <script data-business-id="..."> tag,
 * find our own <script> element, read its config, and inject
 * <loyalty-widget> into the page automatically. Devs who instead place
 * <loyalty-widget> manually (inline mode, or a bundler/npm import) can
 * skip this — it's a no-op if a business-id attribute is not present on
 * a script tag.
 */
function autoMount() {
  const currentScript =
    (document.currentScript as HTMLScriptElement | null) ??
    Array.from(document.querySelectorAll('script')).find((s) =>
      s.src.includes('widget.js'),
    );

  if (!currentScript) return;

  const businessId = currentScript.dataset.businessId;
  if (!businessId) return; // dev is placing <loyalty-widget> manually

  if (currentScript.dataset.trigger === 'manual') {
    // Expose a global so the host page can open it from their own button.
    window.LoyaltyWidget = {
      open: () => {
        const el = document.querySelector('loyalty-widget');
        el?.setAttribute('open', '');
      },
    };
  }

  const el = document.createElement('loyalty-widget');
  el.setAttribute('business-id', businessId);
  if (currentScript.dataset.apiBase) {
    el.setAttribute('api-base', currentScript.dataset.apiBase);
  }
  if (currentScript.dataset.position === 'bottom-left') {
    el.setAttribute('position', 'left');
  }
  if (currentScript.dataset.theme) {
    el.setAttribute('theme', currentScript.dataset.theme);
  }
  if (currentScript.dataset.strings) {
    el.setAttribute('strings', currentScript.dataset.strings);
  }

  document.body.appendChild(el);
}

declare global {
  interface Window {
    LoyaltyWidget: { open: () => void };
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', autoMount);
} else {
  autoMount();
}