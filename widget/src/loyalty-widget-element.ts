import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import jsQR from 'jsqr';
import { ApiClient, BusinessConfig, Card } from './api-client';

type View = 'loading' | 'login' | 'otp' | 'card' | 'checkin' | 'error';

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
  /** Position of the floating launcher: 'right' (default) or 'left'. */
  @property({ attribute: 'position' }) position = 'right';
  /** 'light' (default) or 'dark'. */
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

  private api!: ApiClient;
  private stream: MediaStream | null = null;
  private scanRaf = 0;

  static styles = css`
    :host {
      --brand: var(--loyalty-accent-color, #111827);
      --radius: 14px;
      --panel-bg: #ffffff;
      --panel-border: #e5e7eb;
      --panel-text: #111827;
      --panel-muted: #6b7280;
      --panel-input-border: #d1d5db;
      --panel-input-bg: #ffffff;
      --track-bg: #f3f4f6;
      font-family:
        system-ui,
        -apple-system,
        Segoe UI,
        Roboto,
        sans-serif;
      color: var(--panel-text);
    }

    :host([theme='dark']) {
      --panel-bg: #1f2937;
      --panel-border: #374151;
      --panel-text: #f9fafb;
      --panel-muted: #9ca3af;
      --panel-input-border: #4b5563;
      --panel-input-bg: #111827;
      --track-bg: #374151;
      color: var(--panel-text);
    }

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
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
      z-index: 999999;
      font-size: 22px;
      font-weight: 700;
      border: none;
    }

    :host([position='left']) .launcher {
      right: auto;
      left: 20px;
    }

    .panel {
      position: fixed;
      bottom: 88px;
      right: 20px;
      width: 320px;
      max-height: 480px;
      background: var(--panel-bg);
      color: var(--panel-text);
      border: 1px solid var(--panel-border);
      border-radius: var(--radius);
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.18);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      z-index: 999999;
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
    }

    .header {
      background: var(--brand);
      color: white;
      padding: 16px;
      font-weight: 600;
    }

    .body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid var(--panel-input-border);
      border-radius: 8px;
      margin-bottom: 10px;
      font-size: 14px;
      background: var(--panel-input-bg);
      color: var(--panel-text);
    }

    button.primary {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: none;
      background: var(--brand);
      color: white;
      font-weight: 600;
      cursor: pointer;
    }

    button.secondary {
      width: 100%;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--panel-border);
      background: transparent;
      color: var(--panel-text);
      font-weight: 600;
      cursor: pointer;
      margin-bottom: 10px;
    }

    button.link {
      background: none;
      border: none;
      color: var(--brand);
      cursor: pointer;
      padding: 0;
      margin-bottom: 10px;
      font-size: 13px;
      text-decoration: underline;
    }

    .video-box {
      width: 100%;
      height: 180px;
      background: #000;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 10px;
    }

    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .success-banner {
      border: 1px solid #d1fae5;
      background: #ecfdf5;
      color: #065f46;
      border-radius: 10px;
      padding: 12px;
      margin-bottom: 12px;
      font-weight: 600;
    }

    .progress-track {
      background: var(--track-bg);
      border-radius: 999px;
      height: 10px;
      overflow: hidden;
      margin: 12px 0;
    }

    .progress-fill {
      background: var(--brand);
      height: 100%;
      transition: width 0.3s ease;
    }

    .reward-card {
      border: 1px solid #d1fae5;
      background: #ecfdf5;
      color: #065f46;
      border-radius: 10px;
      padding: 12px;
      margin-top: 12px;
    }

    .error {
      color: #b91c1c;
      font-size: 13px;
      margin-bottom: 8px;
    }

    .muted {
      color: var(--panel-muted);
      font-size: 12px;
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
      // A token from a different business must never be shown on this one.
      if (this.business && this.card.business.id !== this.business.id) {
        this.api.clearToken();
        this.view = 'login';
        return;
      }
      this.view = 'card';
    } catch {
      this.view = 'login';
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
        // A transient decode failure must not kill the scanner.
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
      this.checkinMessage = result.reward
        ? `${this.strings.rewardUnlocked} ${this.formatReward(
            result.reward.type,
            result.reward.value,
          )}`
        : this.strings.checkinSuccess;
      this.view = 'card';
    } catch (err) {
      this.errorMessage = (err as Error).message;
      this.view = 'checkin';
      void this.startScanner();
    }
  }

  private renderCheckin() {
    return html`
      <button class="link" @click=${this.backToCard}>← ${this.strings.back}</button>
      <p class="muted">${this.strings.scanPrompt}</p>
      ${this.errorMessage ? html`<p class="error">${this.errorMessage}</p>` : ''}
      ${this.scanning
        ? html`<div class="video-box"><video autoplay playsinline muted></video></div>`
        : this.scanError
          ? html`<p class="error">${this.scanError}</p>`
          : ''}
      <form @submit=${this.submitCheckin}>
        <input
          placeholder=${this.strings.manualPlaceholder}
          .value=${this.checkinTokenInput}
          @input=${(e: InputEvent) =>
            (this.checkinTokenInput = (e.target as HTMLInputElement).value)}
        />
        <button class="primary" type="submit">${this.strings.checkIn}</button>
      </form>
    `;
  }

  private buildIdentifier() {
    return this.identifierInput.includes('@')
      ? { email: this.identifierInput }
      : { phone: this.identifierInput };
  }

  private launcherLabel() {
    if (this.view === 'card' || this.view === 'loading') {
      return this.business?.name.charAt(0).toUpperCase() ?? '🎁';
    }
    return '🎁';
  }

  render() {
    if (!this.isOpen && !this.inline) {
      return html`<button
        class="launcher"
        @click=${this.toggle}
        aria-label=${this.strings.loyaltyRewards}
        aria-expanded="false"
      >
        ${this.launcherLabel()}
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
            ✕
          </button>`
        : ''}
      <div class="panel">
        <div class="header">${this.business?.name ?? this.strings.loyaltyRewards}</div>
        <div class="body">${this.renderView()}</div>
      </div>
    `;
  }

  private renderView() {
    switch (this.view) {
      case 'loading':
        return html`<p class="muted">${this.strings.loading}</p>`;
      case 'error':
        return html`
          <p class="error">${this.errorMessage}</p>
          <p class="muted">${this.strings.checkinError}</p>
        `;
      case 'login':
        return html`
          <form @submit=${this.submitIdentifier}>
            <p class="muted">${this.strings.loginPrompt}</p>
            ${this.errorMessage ? html`<p class="error">${this.errorMessage}</p>` : ''}
            <input
              placeholder=${this.strings.identifierPlaceholder}
              .value=${this.identifierInput}
              @input=${(e: InputEvent) =>
                (this.identifierInput = (e.target as HTMLInputElement).value)}
            />
            <button class="primary" type="submit">${this.strings.sendCode}</button>
          </form>
        `;
      case 'otp':
        return html`
          <form @submit=${this.submitCode}>
            <p class="muted">${this.strings.otpPrompt}</p>
            ${this.errorMessage ? html`<p class="error">${this.errorMessage}</p>` : ''}
            <input
              placeholder=${this.strings.otpPlaceholder}
              maxlength="6"
              inputmode="numeric"
              pattern="[0-9]*"
              .value=${this.codeInput}
              @input=${(e: InputEvent) => (this.codeInput = (e.target as HTMLInputElement).value)}
            />
            <button class="primary" type="submit">${this.strings.verify}</button>
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
    const progress = this.strings.rewardProgress
      .replace('{stamps}', String(this.card.stamps))
      .replace('{threshold}', String(this.business.stampThreshold));

    return html`
      ${this.checkinMessage
        ? html`<div class="success-banner" role="status">${this.checkinMessage}</div>`
        : ''}
      <button class="primary" style="margin-bottom:12px" @click=${this.openCheckin}>
        ${this.strings.checkIn}
      </button>
      <p class="muted">${progress}</p>
      <div class="progress-track">
        <div class="progress-fill" style="width:${pct}%"></div>
      </div>
      ${this.card.rewards.length
        ? this.card.rewards.map(
            (r) => html`
              <div class="reward-card">
                <strong>${this.formatReward(r.type, r.value)}</strong>
                <div class="muted">
                  ${this.strings.rewardExpires.replace(
                    '{date}',
                    new Date(r.expiresAt).toLocaleDateString(),
                  )}
                </div>
                <button class="primary" style="margin-top:8px" @click=${() => this.redeem(r.id)}>
                  ${this.strings.redeemNow}
                </button>
              </div>
            `,
          )
        : html`<p class="muted">${this.strings.rewardKeepVisiting}</p>`}
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