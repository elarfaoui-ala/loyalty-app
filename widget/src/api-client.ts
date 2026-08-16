export interface BusinessConfig {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  logoUrl?: string;
  stampThreshold: number;
  rewardType: 'PERCENT_OFF' | 'FIXED_OFF' | 'FREE_ITEM';
  rewardValue: number;
}

export interface Reward {
  id: string;
  type: BusinessConfig['rewardType'];
  value: number;
  status: 'PENDING' | 'REDEEMED' | 'EXPIRED';
  expiresAt: string;
}

export interface Card {
  id: string;
  stamps: number;
  totalRedeemed: number;
  rewards: Reward[];
  business: { id: string; stampThreshold: number; rewardType: string; rewardValue: number };
}

export class ApiClient {
  private customerToken: string | null = null;

  constructor(private readonly baseUrl: string) {}

  setToken(token: string | null) {
    this.customerToken = token;
    if (token) {
      localStorage.setItem('loyalty_customer_token', token);
    } else {
      localStorage.removeItem('loyalty_customer_token');
    }
  }

  clearToken() {
    this.setToken(null);
  }

  loadStoredToken(): string | null {
    this.customerToken = localStorage.getItem('loyalty_customer_token');
    return this.customerToken;
  }

  private async request<T>(
    path: string,
    options: RequestInit & { auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };
    if (options.auth) {
      if (!this.customerToken) throw new Error('Not authenticated');
      headers.Authorization = `Bearer ${this.customerToken}`;
    }

    const res = await fetch(`${this.baseUrl}${path}`, { ...options, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new Error(body.message ?? `Request failed (${res.status})`);
    }
    return res.json();
  }

  getBusiness(slug: string) {
    return this.request<BusinessConfig>(`/public/business/${slug}`);
  }

  requestOtp(businessSlug: string, identifier: { email?: string; phone?: string }) {
    return this.request<{ sent: boolean }>('/public/otp/request', {
      method: 'POST',
      body: JSON.stringify({ businessSlug, ...identifier }),
    });
  }

  async verifyOtp(
    businessSlug: string,
    identifier: { email?: string; phone?: string },
    code: string,
  ) {
    const result = await this.request<{ customerToken: string }>('/public/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ businessSlug, ...identifier, code }),
    });
    this.setToken(result.customerToken);
    return result;
  }

  getCard() {
    return this.request<Card>('/public/card', { auth: true });
  }

  checkin(checkinToken: string) {
    return this.request<{ card: Card; reward?: Reward | null }>('/public/checkin', {
      method: 'POST',
      auth: true,
      body: JSON.stringify({ checkinToken }),
    });
  }

  redeemReward(rewardId: string) {
    return this.request(`/public/rewards/${rewardId}/redeem`, {
      method: 'POST',
      auth: true,
    });
  }
}
