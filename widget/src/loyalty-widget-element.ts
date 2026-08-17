import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import jsQR from 'jsqr';
import { ApiClient, BusinessConfig, Card } from './api-client';

type View = 'loading' | 'login' | 'otp' | 'card' | 'checkin' | 'error';

const icon = (d: string, size = 18) =>
  html`<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

const ICO = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  scan: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="12" y1="7" x2="12" y2="17"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
};

/** User-facing copy. Every string can be overridden via the `strings`
 * attribute (a JSON object) or the `data-strings` script-tag attribute. */
export interface WidgetStrings {
  loading: string;
  loginPrompt: string;
  identifierPlaceholder: string;
  sendCode: string;
  otpPrompt: string;
  otpPlaceholder: string;
  verify: string;
  checkIn: string;
  scanPrompt: string;
  scanUnavailable: string;
  manualPlaceholder: string;
  checkinSuccess: string;
  rewardUnlocked: string;
  rewardProgress: string;
  rewardKeepVisiting: string;
  rewardExpires: string;
  redeemNow: string;
  back: string;
  close: string;
  loyaltyRewards: string;
  checkinError: string;
  rewardPercent: string;
  rewardFixed: string;
  rewardFree: string;
}

export const DEFAULT_STRINGS: WidgetStrings = {
  loading: 'Loading…',
  loginPrompt: 'Enter your email or phone to see your rewards.',
  identifierPlaceholder: 'you@example.com',
  sendCode: 'Send code',
  otpPrompt: 'Enter the 6-digit code we sent you.',
  otpPlaceholder: '123456',
  verify: 'Verify',
  checkIn: 'Check in',
  scanPrompt: 'Point your camera at the QR code at the register, or paste the code below.',
  scanUnavailable: 'Camera unavailable. Paste the code from the register QR instead.',
  manualPlaceholder: 'Paste the check-in code',
  checkinSuccess: 'Stamp added!',
  rewardUnlocked: 'Reward unlocked!',
  rewardProgress: '{stamps} / {threshold} visits toward your next reward',
  rewardKeepVisiting: 'Keep visiting to unlock your reward!',
  rewardExpires: 'Expires {date}',
  redeemNow: 'Redeem now',
  back: 'Back',
  close: 'Close rewards',
  loyaltyRewards: 'Loyalty rewards',
  checkinError: "Check that the script tag's business id is correct.",
  rewardPercent: '{value}% off your next order',
  rewardFixed: '{value} off your next order',
  rewardFree: 'Free item unlocked',
};

@customElement('loyalty-widget')
export class LoyaltyWidgetElement extends LitElement {
  @property({ attribute: 'business-id' }) businessId = '';
  @property({ attribute: 'api-base' }) apiBase = 'https://api.yourloyaltyapp.com/api/v1';
  @property({ type: Boolean }) inline = false;
  @property({ attribute: 'open' }) startOpen = false;
  @property({ attribute: 'position' }) position = 'right';
  @property({ attribute: 'theme' }) theme = 'light';

  @state() private isOpen = false;
  @state() private view: View = 'loading';
  @state() private business: BusinessConfig | null = null;
  @state() private card: Card | null = null;
  @state() private errorMessage = '';
  @state() private identifierInput = '';
  @state() private codeInput = '';
  @state() private checkinTokenInput = '';
  @state() private scanning = false;
  @state() private scanError = '';
  @state() private checkinMessage = '';
  @state() private strings: WidgetStrings = DEFAULT_STRINGS;
  @state() private hasNewReward = false;

  private api!: ApiClient;
  private stream: MediaStream | null = null;
  private scanRaf = 0;

  static styles = css`
    :host {
      --brand: var(--loyalty-accent-color, #6366f1);
      --brand-hover: color-mix(in srgb, var(--brand) 85%, black);
      --radius: 16px;
      --panel-bg: #ffffff;
      --panel-border: #e2e8f0;
      --panel-text: #0f172a;
      --panel-muted: #94a3b8;
      --panel-input-border: #e2e8f0;
      --panel-input-bg: #f8fafc;
      --track-bg: #f1f5f9;
      --success-bg: #ecfdf5;
      --success-text: #065f46;
      --success-border: #a7f3d0;
      --error-color: #ef4444;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      color: var(--panel-text);
    }

    :host([theme='dark']) {
      --panel-bg: #1e293b;
      --panel-border: #334155;
      --panel-text: #f1f5f9;
      --panel-muted: #94a3b8;
      --panel-input-border: #475569;
      --panel-input-bg: #0f172a;
      --track-bg: #334155;
      color: var(--panel-text);
    }

    .icon { display: inline-block; vertical-align: middle; }

    /* ── Animations ── */
    @keyframes widget-launcher-in {
      0% { transform: scale(0) rotate(-45deg); opacity: 0; }
      60% { transform: scale(1.1) rotate(0deg); }
      100% { transform: scale(1) rotate(0deg); opacity: 1; }
    }

    @keyframes widget-panel-in {
      0% { opacity: 0; transform: translateY(16px) scale(0.96); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes widget-pulse {
      0%, 100% { box-shadow: 0 6px 20px rgba(0,0,0,0.2); }
      50% { box-shadow: 0 6px 20px rgba(0,0,0,0.2), 0 0 0 6px color-mix(in srgb, var(--brand) 30%, transparent); }
    }

    @keyframes widget-scan-line {
      0%, 100% { top: 10%; }
      50% { top: 85%; }
    }

    @keyframes widget-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes widget-confetti-pop {
      0% { transform: translateY(0) scale(0); opacity: 1; }
      50% { transform: translateY(-30px) scale(1.2); opacity: 1; }
      100% { transform: translateY(-60px) scale(0.5); opacity: 0; }
    }

    @keyframes widget-success-pop {
      0% { transform: scale(0.8); opacity: 0; }
      50% { transform: scale(1.05); }
      100% { transform: scale(1); opacity: 1; }
    }

    /* ── Launcher ── */
    .launcher {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: var(--brand);
      color: white;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,0.15), 0 2px 6px rgba(0,0,0,0.1);
      z-index: 999999;
      border: none;
      transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease;
      animation: widget-launcher-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
      -webkit-tap-highlight-color: transparent;
    }

    .launcher:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    }

    .launcher:active {
      transform: scale(0.95);
    }

    .launcher.pulse {
      animation: widget-pulse 1.5s ease-in-out 3;
    }

    :host([position='left']) .launcher {
      right: auto;
      left: 20px;
    }

    .launcher-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      line-height: 1;
      user-select: none;
    }

    .launcher-label {
      position: absolute;
      right: 64px;
      top: 50%;
      transform: translateY(-50%);
      background: var(--panel-bg);
      color: var(--panel-text);
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }

    .launcher-label::after {
      content: '';
      position: absolute;
      right: -6px;
      top: 50%;
      transform: translateY(-50%);
      border: 6px solid transparent;
      border-left-color: var(--panel-bg);
    }

    :host([position='left']) .launcher-label {
      right: auto;
      left: 64px;
    }

    :host([position='left']) .launcher-label::after {
      right: auto;
      left: -6px;
      border-left-color: transparent;
      border-right-color: var(--panel-bg);
    }

    .launcher:hover .launcher-label {
      opacity: 1;
    }

    /* ── Panel ── */
    .panel {
      position: fixed;
      bottom: 88px;
      right: 20px;
      width: 320px;
      max-height: 500px;
      background: var(--panel-bg);
      color: var(--panel-text);
      border: 1px solid var(--panel-border);
      border-radius: var(--radius);
      box-shadow: 0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      z-index: 999999;
      animation: widget-panel-in 0.3s cubic-bezier(0.16, 1, 0.3, 1) both;
    }

    :host([position='left']) .panel {
      right: auto;
      left: 20px;
    }

    :host([inline]) .panel {
      position: static;
      width: 100%;
      max-width: 360px;
      box-shadow: none;
      animation: none;
    }

    .header {
      background: var(--brand);
      color: white;
      padding: 16px 18px;
      font-weight: 600;
      font-size: 15px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    /* ── Forms ── */
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 14px;
      border: 1px solid var(--panel-input-border);
      border-radius: 10px;
      margin-bottom: 10px;
      font-size: 14px;
      font-family: inherit;
      background: var(--panel-input-bg);
      color: var(--panel-text);
      outline: none;
      transition: border-color 0.2s ease, box-shadow 0.2s ease;
    }

    input:focus {
      border-color: var(--brand);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--brand) 20%, transparent);
    }

    input::placeholder { color: var(--panel-muted); }

    button.primary {
      width: 100%;
      padding: 11px 14px;
      border-radius: 10px;
      border: none;
      background: var(--brand);
      color: white;
      font-weight: 600;
      font-size: 14px;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
      -webkit-tap-highlight-color: transparent;
    }

    button.primary:hover {
      background: var(--brand-hover);
      box-shadow: 0 2px 8px color-mix(in srgb, var(--brand) 30%, transparent);
    }

    button.primary:active {
      transform: scale(0.98);
    }

    button.secondary {
      width: 100%;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid var(--panel-border);
      background: transparent;
      color: var(--panel-text);
      font-weight: 600;
      font-size: 14px;
      font-family: inherit;
      cursor: pointer;
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background 0.15s ease, border-color 0.15s ease;
    }

    button.secondary:hover {
      background: var(--track-bg);
      border-color: var(--panel-muted);
    }

    button.link {
      background: none;
      border: none;
      color: var(--brand);
      cursor: pointer;
      padding: 0;
      margin-bottom: 10px;
      font-size: 13px;
      font-family: inherit;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: opacity 0.15s ease;
    }

    button.link:hover { opacity: 0.7; }

    /* ── QR Scanner ── */
    .video-box {
      width: 100%;
      height: 200px;
      background: #000;
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 12px;
      position: relative;
    }

    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .scan-overlay {
      position: absolute;
      inset: 0;
      pointer-events: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .scan-corners {
      width: 140px;
      height: 140px;
      position: relative;
    }

    .scan-corners::before,
    .scan-corners::after,
    .scan-corner-bl,
    .scan-corner-br {
      content: '';
      position: absolute;
      width: 28px;
      height: 28px;
      border-color: white;
      border-style: solid;
    }

    .scan-corners::before {
      top: 0; left: 0;
      border-width: 3px 0 0 3px;
      border-radius: 6px 0 0 0;
    }

    .scan-corners::after {
      top: 0; right: 0;
      border-width: 3px 3px 0 0;
      border-radius: 0 6px 0 0;
    }

    .scan-corner-bl {
      bottom: 0; left: 0;
      border-width: 0 0 3px 3px;
      border-radius: 0 0 0 6px;
    }

    .scan-corner-br {
      bottom: 0; right: 0;
      border-width: 0 3px 3px 0;
      border-radius: 0 0 6px 0;
    }

    .scan-line {
      position: absolute;
      left: 12px;
      right: 12px;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--brand), transparent);
      box-shadow: 0 0 8px var(--brand);
      animation: widget-scan-line 2.5s ease-in-out infinite;
    }

    /* ── Success banner ── */
    .success-banner {
      border: 1px solid var(--success-border);
      background: var(--success-bg);
      color: var(--success-text);
      border-radius: 12px;
      padding: 14px;
      margin-bottom: 14px;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      animation: widget-success-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }

    /* ── Confetti ── */
    .confetti-wrap {
      position: relative;
      overflow: visible;
    }

    .confetti-particle {
      position: absolute;
      width: 6px;
      height: 6px;
      border-radius: 1px;
      animation: widget-confetti-pop 0.8s ease-out both;
    }

    /* ── Progress ── */
    .progress-track {
      background: var(--track-bg);
      border-radius: 999px;
      height: 8px;
      overflow: hidden;
      margin: 10px 0;
    }

    .progress-fill {
      background: linear-gradient(90deg, var(--brand), color-mix(in srgb, var(--brand) 70%, #8b5cf6));
      height: 100%;
      border-radius: 999px;
      transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* ── Reward cards ── */
    .reward-card {
      border: 1px solid var(--success-border);
      background: var(--success-bg);
      color: var(--success-text);
      border-radius: 12px;
      padding: 14px;
      margin-top: 12px;
      animation: widget-fade-in 0.3s ease both;
    }

    .reward-card strong {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
    }

    /* ── Stamps visual ── */
    .stamps-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin: 10px 0;
    }

    .stamp-dot {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 2px solid var(--panel-border);
      background: var(--panel-input-bg);
      transition: all 0.3s ease;
    }

    .stamp-dot.filled {
      background: var(--brand);
      border-color: var(--brand);
      box-shadow: 0 0 6px color-mix(in srgb, var(--brand) 30%, transparent);
    }

    /* ── Empty state ── */
    .empty-state {
      text-align: center;
      padding: 20px 0;
    }

    .empty-state-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--track-bg);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 10px;
      color: var(--panel-muted);
    }

    .error {
      color: var(--error-color);
      font-size: 13px;
      margin-bottom: 8px;
    }

    .muted {
      color: var(--panel-muted);
      font-size: 12px;
      line-height: 1.5;
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid var(--track-bg);
      border-top-color: var(--brand);
      border-radius: 50%;
      animation: widget-spin 0.7s linear infinite;
      margin: 24px auto;
    }

    @keyframes widget-spin {
      to { transform: rotate(360deg); }
    }

    .loading-state {
      text-align: center;
      padding: 24px 0;
    }

    .error-state {
      text-align: center;
      padding: 16px 0;
    }

    .error-state-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #fef2f2;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 10px;
      color: var(--error-color);
      font-size: 22px;
    }

    .error-state p {
      margin: 4px 0;
    }

    .hint {
      color: var(--panel-muted);
      font-size: 11px;
      margin-top: -6px;
      margin-bottom: 10px;
    }

    .success-anim {
      animation: widget-success-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }

    .checkin-success {
      text-align: center;
      padding: 12px 0;
    }

    .checkin-success-icon {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: var(--success-bg);
      color: var(--success-text);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 8px;
      font-size: 24px;
      animation: widget-success-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }

    .divider {
      display: flex;
      align-items: center;
      gap: 10px;
      margin: 12px 0;
      color: var(--panel-muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .divider::before,
    .divider::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--panel-border);
    }

    .scan-start-btn {
      width: 100%;
      padding: 12px;
      border-radius: 12px;
      border: 2px dashed var(--panel-border);
      background: transparent;
      color: var(--brand);
      font-weight: 600;
      font-size: 14px;
      font-family: inherit;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 10px;
      transition: border-color 0.2s, background 0.2s;
    }

    .scan-start-btn:hover {
      border-color: var(--brand);
      background: color-mix(in srgb, var(--brand) 5%, transparent);
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    this.isOpen = this.startOpen || this.inline;
    this.api = new ApiClient(this.apiBase);
  }

  protected async firstUpdated(): Promise<void> {
    this.strings = this.parseStrings();
    try {
      this.business = await this.api.getBusiness(this.businessId);
      const stored = this.api.loadStoredToken();
      if (stored) {
        await this.loadCard();
      } else {
        this.view = 'login';
      }
    } catch (err) {
      this.errorMessage = (err as Error).message;
      this.view = 'error';
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stopScanner();
  }

  private parseStrings(): WidgetStrings {
    const raw = this.getAttribute('strings');
    if (!raw) return DEFAULT_STRINGS;
    try {
      return { ...DEFAULT_STRINGS, ...(JSON.parse(raw) as Partial<WidgetStrings>) };
    } catch {
      return DEFAULT_STRINGS;
    }
  }

  private async loadCard() {
    try {
      this.card = await this.api.getCard();
      if (this.business && this.card.business.id !== this.business.id) {
        this.api.clearToken();
        this.view = 'login';
        return;
      }
      this.view = 'card';
    } catch (err) {
      if ((err as Error).message.includes('Not authenticated') || (err as Error).message.includes('Invalid or expired token')) {
        this.api.clearToken();
        this.view = 'login';
      } else {
        this.card = {
          id: '',
          stamps: 0,
          totalRedeemed: 0,
          rewards: [],
          business: {
            id: this.business?.id ?? '',
            stampThreshold: this.business?.stampThreshold ?? 10,
            rewardType: this.business?.rewardType ?? 'FREE_ITEM',
            rewardValue: this.business?.rewardValue ?? 0,
          },
        };
        this.view = 'card';
      }
    }
  }

  private toggle = () => {
    this.isOpen = !this.isOpen;
    if (!this.isOpen) this.stopScanner();
  };

  private async submitIdentifier(e: Event) {
    e.preventDefault();
    if (!this.business) return;
    try {
      await this.api.requestOtp(this.business.slug, this.buildIdentifier());
      this.view = 'otp';
      this.errorMessage = '';
    } catch (err) {
      this.errorMessage = (err as Error).message;
    }
  }

  private async submitCode(e: Event) {
    e.preventDefault();
    if (!this.business) return;
    try {
      await this.api.verifyOtp(this.business.slug, this.buildIdentifier(), this.codeInput);
      await this.loadCard();
      this.errorMessage = '';
    } catch (err) {
      this.errorMessage = (err as Error).message;
    }
  }

  private async redeem(rewardId: string) {
    try {
      await this.api.redeemReward(rewardId);
      await this.loadCard();
    } catch (err) {
      this.errorMessage = (err as Error).message;
    }
  }

  private openCheckin = () => {
    this.checkinMessage = '';
    this.errorMessage = '';
    this.scanError = '';
    this.checkinTokenInput = '';
    this.view = 'checkin';
    void this.startScanner();
  };

  private backToCard = () => {
    this.stopScanner();
    this.view = 'card';
  };

  private async startScanner() {
    this.stopScanner();
    if (!navigator.mediaDevices?.getUserMedia) {
      this.scanError = this.strings.scanUnavailable;
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      this.scanning = true;
      this.scanError = '';
      await this.updateComplete;
      const video = this.renderRoot.querySelector<HTMLVideoElement>('video');
      if (!video) {
        this.stopScanner();
        return;
      }
      video.srcObject = this.stream;
      await video.play();
      this.scanLoop(video);
    } catch {
      this.scanError = this.strings.scanUnavailable;
    }
  }

  private stopScanner() {
    this.scanning = false;
    cancelAnimationFrame(this.scanRaf);
    this.scanRaf = 0;
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  private async scanLoop(video: HTMLVideoElement) {
    const barcodeDetector = 'BarcodeDetector' in window
      ? new window.BarcodeDetector!({ formats: ['qr_code'] })
      : null;
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let ticking = false;

    const tick = async () => {
      if (!this.scanning || ticking || this.view !== 'checkin') return;
      ticking = true;
      try {
        let text: string | null = null;
        if (barcodeDetector) {
          const results = await barcodeDetector.detect(video);
          if (results.length && results[0].rawValue) text = results[0].rawValue;
        } else if (ctx && video.videoWidth > 0) {
          ctx.drawImage(video, 0, 0, 320, 240);
          const frame = ctx.getImageData(0, 0, 320, 240);
          const qr = jsQR(frame.data, frame.width, frame.height, {
            inversionAttempts: 'dontInvert',
          });
          if (qr?.data) text = qr.data;
        }
        if (text) {
          await this.handleCheckin(text);
          return;
        }
      } catch {
        // transient decode failure
      } finally {
        ticking = false;
      }
      this.scanRaf = requestAnimationFrame(tick);
    };

    this.scanRaf = requestAnimationFrame(tick);
  }

  private async submitCheckin(e: Event) {
    e.preventDefault();
    if (!this.checkinTokenInput.trim()) return;
    await this.handleCheckin(this.checkinTokenInput.trim());
  }

  private async handleCheckin(token: string) {
    this.stopScanner();
    this.errorMessage = '';
    try {
      const result = await this.api.checkin(token);
      this.card = await this.api.getCard();
      if (result.reward) {
        this.hasNewReward = true;
        this.checkinMessage = `${this.strings.rewardUnlocked} ${this.formatReward(result.reward.type, result.reward.value)}`;
        setTimeout(() => { this.hasNewReward = false; }, 3000);
      } else {
        this.checkinMessage = this.strings.checkinSuccess;
      }
      this.view = 'card';
      setTimeout(() => { this.checkinMessage = ''; }, 4000);
    } catch (err) {
      this.errorMessage = (err as Error).message;
      this.view = 'checkin';
    }
  }

  private renderCheckin() {
    return html`
      <button class="link" @click=${this.backToCard}>${icon(ICO.back, 14)} ${this.strings.back}</button>
      <p style="font-weight:600;font-size:15px;margin-bottom:2px">Check in</p>
      <p class="muted">${this.strings.scanPrompt}</p>
      ${this.errorMessage ? html`<p class="error">${this.errorMessage}</p>` : ''}
      ${this.scanning
        ? html`
            <div class="video-box">
              <video autoplay playsinline muted></video>
              <div class="scan-overlay">
                <div class="scan-corners">
                  <div class="scan-corner-bl"></div>
                  <div class="scan-corner-br"></div>
                  <div class="scan-line"></div>
                </div>
              </div>
            </div>
            <button class="secondary" @click=${this.stopScanner} style="margin-top:8px">${icon(ICO.x, 14)} Stop camera</button>`
        : html`
            <button class="scan-start-btn" @click=${() => void this.startScanner()}>
              ${icon(ICO.scan, 18)} Scan QR code
            </button>
          `}
      <div class="divider">or paste code</div>
      <form @submit=${this.submitCheckin}>
        <input
          placeholder=${this.strings.manualPlaceholder}
          .value=${this.checkinTokenInput}
          @input=${(e: InputEvent) =>
            (this.checkinTokenInput = (e.target as HTMLInputElement).value)}
        />
        <button class="primary" type="submit" ?disabled=${!this.checkinTokenInput.trim()}>${icon(ICO.check, 16)} ${this.strings.checkIn}</button>
      </form>
    `;
  }

  private buildIdentifier() {
    return this.identifierInput.includes('@')
      ? { email: this.identifierInput }
      : { phone: this.identifierInput };
  }

  private launcherLabel() {
    return this.business?.name.charAt(0).toUpperCase() ?? '★';
  }

  private renderConfetti() {
    if (!this.hasNewReward) return '';
    const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    const particles = Array.from({ length: 12 }, (_, i) => {
      const color = colors[i % colors.length];
      const x = (Math.random() * 80 - 40);
      const delay = Math.random() * 0.3;
      return `<div class="confetti-particle" style="background:${color};left:calc(50% + ${x}px);top:0;animation-delay:${delay}s"></div>`;
    }).join('');
    return `<div class="confetti-wrap" style="position:absolute;top:-10px;left:0;right:0;height:0;overflow:visible;pointer-events:none">${particles}</div>`;
  }

  render() {
    if (!this.isOpen && !this.inline) {
      return html`<button
        class="launcher ${this.hasNewReward ? 'pulse' : ''}"
        @click=${this.toggle}
        aria-label=${this.strings.loyaltyRewards}
        aria-expanded="false"
      >
        <span class="launcher-label">${this.business?.name ?? 'Rewards'}</span>
        <span class="launcher-icon">&#11088;</span>
      </button>`;
    }

    return html`
      ${!this.inline
        ? html`<button
            class="launcher"
            @click=${this.toggle}
            aria-label=${this.strings.close}
            aria-expanded="true"
          >
            <span class="launcher-icon">&#10005;</span>
          </button>`
        : ''}
      <div class="panel">
        <div class="header">
          <span style="font-size:18px">&#11088;</span>
          <span>${this.business?.name ?? this.strings.loyaltyRewards}</span>
        </div>
        <div class="body">${this.renderView()}</div>
      </div>
    `;
  }

  private renderView() {
    switch (this.view) {
      case 'loading':
        return html`<div class="loading-state"><div class="spinner"></div><p class="muted">${this.strings.loading}</p></div>`;
      case 'error':
        return html`
          <div class="error-state">
            <div class="error-state-icon">&#9888;</div>
            <p><strong>Something went wrong</strong></p>
            <p class="error">${this.errorMessage}</p>
            <p class="muted">${this.strings.checkinError}</p>
          </div>
        `;
      case 'login':
        return html`
          <form @submit=${this.submitIdentifier}>
            <div style="text-align:center;margin-bottom:14px">
              <div style="width:48px;height:48px;border-radius:50%;background:color-mix(in srgb, var(--brand) 10%, transparent);display:inline-flex;align-items:center;justify-content:center;color:var(--brand);font-size:24px">&#128100;</div>
            </div>
            <p style="text-align:center;font-weight:600;font-size:15px;margin-bottom:4px">Welcome!</p>
            <p class="muted" style="text-align:center;margin-bottom:14px">${this.strings.loginPrompt}</p>
            ${this.errorMessage ? html`<p class="error">${this.errorMessage}</p>` : ''}
            <input
              type="email"
              placeholder="Email address"
              .value=${this.identifierInput}
              @input=${(e: InputEvent) =>
                (this.identifierInput = (e.target as HTMLInputElement).value)}
            />
            <p class="hint" style="text-align:center">We'll send you a 6-digit code to sign in</p>
            <button class="primary" type="submit">${icon(ICO.send, 16)} ${this.strings.sendCode}</button>
          </form>
        `;
      case 'otp':
        return html`
          <form @submit=${this.submitCode}>
            <button class="link" @click=${() => { this.view = 'login'; this.codeInput = ''; }}>${icon(ICO.back, 14)} Back</button>
            <div style="text-align:center;margin-bottom:14px">
              <div style="width:48px;height:48px;border-radius:50%;background:color-mix(in srgb, var(--brand) 10%, transparent);display:inline-flex;align-items:center;justify-content:center;color:var(--brand);font-size:24px">&#128232;</div>
            </div>
            <p style="text-align:center;font-weight:600;font-size:15px;margin-bottom:4px">Check your inbox</p>
            <p class="muted" style="text-align:center;margin-bottom:14px">${this.strings.otpPrompt}</p>
            ${this.errorMessage ? html`<p class="error">${this.errorMessage}</p>` : ''}
            <input
              placeholder="Enter 6-digit code"
              maxlength="6"
              inputmode="numeric"
              pattern="[0-9]*"
              style="text-align:center;font-size:20px;letter-spacing:6px;padding:14px"
              .value=${this.codeInput}
              @input=${(e: InputEvent) => (this.codeInput = (e.target as HTMLInputElement).value)}
            />
            <p class="hint" style="text-align:center">Didn't get it? Check your spam folder</p>
            <button class="primary" type="submit">${icon(ICO.check, 16)} ${this.strings.verify}</button>
          </form>
        `;
      case 'checkin':
        return this.renderCheckin();
      case 'card':
        return this.renderCard();
      default:
        return html``;
    }
  }

  private renderCard() {
    if (!this.card || !this.business) return html``;
    const pct = Math.min(100, (this.card.stamps / this.business.stampThreshold) * 100);
    const remaining = Math.max(0, this.business.stampThreshold - this.card.stamps);
    const progress = this.strings.rewardProgress
      .replace('{stamps}', String(this.card.stamps))
      .replace('{threshold}', String(this.business.stampThreshold));

    const stamps = Array.from({ length: this.business.stampThreshold }, (_, i) =>
      i < this.card!.stamps,
    );

    return html`
      <div style="position:relative">
        ${this.renderConfetti()}
        ${this.checkinMessage
          ? html`<div class="success-banner" role="status">${icon(ICO.check, 16)} ${this.checkinMessage}</div>`
          : ''}
        <div class="success-anim" style="text-align:center;margin-bottom:14px">
          <div style="font-size:32px;font-weight:700;color:var(--brand)">${this.card.stamps}</div>
          <div style="font-size:12px;color:var(--panel-muted)">of ${this.business.stampThreshold} visits</div>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <p class="muted" style="text-align:center;margin:8px 0 14px">${remaining > 0 ? `${remaining} more ${remaining === 1 ? 'visit' : 'visits'} to your reward` : 'You earned a reward!'}</p>
        <div class="stamps-row" style="justify-content:center">
          ${stamps.map((filled) => html`<div class="stamp-dot ${filled ? 'filled' : ''}"></div>`)}
        </div>
        <button class="primary" style="margin:14px 0" @click=${this.openCheckin}>
          ${icon(ICO.scan, 16)} Check in now
        </button>
        ${this.card.rewards.length
          ? html`
              <div class="divider">Your rewards</div>
              ${this.card.rewards.map(
                (r) => html`
                  <div class="reward-card">
                    <strong>${icon(ICO.star, 16)} ${this.formatReward(r.type, r.value)}</strong>
                    <div class="muted" style="margin-top:4px">
                      ${icon(ICO.clock, 12)}
                      ${this.strings.rewardExpires.replace(
                        '{date}',
                        new Date(r.expiresAt).toLocaleDateString(),
                      )}
                    </div>
                    <button class="primary" style="margin-top:10px" @click=${() => this.redeem(r.id)}>
                      ${icon(ICO.check, 14)} ${this.strings.redeemNow}
                    </button>
                  </div>
                `,
              )}`
          : html`
              <div class="empty-state">
                <div class="empty-state-icon">&#127873;</div>
                <p style="font-weight:600;margin-bottom:2px">No rewards yet</p>
                <p class="muted">${this.strings.rewardKeepVisiting}</p>
              </div>
            `}
      </div>
    `;
  }

  private formatReward(type: string, value: number) {
    if (type === 'PERCENT_OFF') {
      return this.strings.rewardPercent.replace('{value}', String(value));
    }
    if (type === 'FIXED_OFF') {
      return this.strings.rewardFixed.replace('{value}', String(value));
    }
    return this.strings.rewardFree;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'loyalty-widget': LoyaltyWidgetElement;
  }

  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): {
        detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
      };
    };
  }
}
