import QRCode from 'qrcode';
import { api } from '../api';
import { el } from '../dom';

const REFRESH_INTERVAL_MS = 20_000;

export function renderCheckin(app: HTMLElement): { destroy: () => void } {
  const view = el(`
    <div class="checkin-wrap">
      <h1>Customer check-in</h1>
      <p class="muted">Keep this screen visible at the register. Customers scan the QR in
      the loyalty widget to earn a stamp automatically.</p>
      <div class="qr-frame"><canvas id="qr-canvas"></canvas></div>
      <p class="countdown" id="qr-countdown"></p>
      <p class="muted" id="qr-error"></p>
    </div>
  `);
  app.replaceChildren(view);

  const canvas = view.querySelector<HTMLCanvasElement>('#qr-canvas')!;
  const countdown = view.querySelector('#qr-countdown')!;
  const errorBox = view.querySelector('#qr-error')!;
  let destroyed = false;

  const refreshQr = async (): Promise<void> => {
    try {
      const result = await api<{ checkinToken: string; expiresInSeconds: number }>(
        '/businesses/me/checkin-token',
        { method: 'POST' },
      );
      await QRCode.toCanvas(canvas, result.checkinToken, {
        width: 240,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      errorBox.textContent = '';
      countdown.textContent = `QR refreshes every ${result.expiresInSeconds}s`;
    } catch (err) {
      errorBox.textContent = (err as Error).message;
    }
  };

  void refreshQr();
  const refreshTimer = window.setInterval(() => {
    if (!destroyed) void refreshQr();
  }, REFRESH_INTERVAL_MS);

  return {
    destroy: () => {
      destroyed = true;
      window.clearInterval(refreshTimer);
      view.remove();
    },
  };
}