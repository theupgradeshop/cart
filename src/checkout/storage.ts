const PREFIX = 'upgradeshop.checkout.ownership.';

/** The ownership token lives in sessionStorage keyed by orderId. It is sent only as an `Authorization: Bearer` header, never put in a URL. */
export function storeOwnershipToken(orderId: string, token: string): void {
  try {
    window.sessionStorage.setItem(PREFIX + orderId, token);
  } catch {
    /* storage unavailable: the thank-you falls back to the thin response */
  }
}

export function readOwnershipToken(orderId: string): string | null {
  try {
    return window.sessionStorage.getItem(PREFIX + orderId);
  } catch {
    return null;
  }
}

export function clearOwnershipToken(orderId: string): void {
  try {
    window.sessionStorage.removeItem(PREFIX + orderId);
  } catch {
    /* ignore */
  }
}
