import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { CartProvider } from '../src/cart-context';
import { useCart } from '../src/cart-context';
import { useCartProducts } from '../src/use-cart-products';

const mockProducts = [
  { slug: 'product-a', name: 'Product A', price: 230, salePrice: null, images: [{ url: '/a.jpg', alt: 'A' }], status: 'active', variants: [] },
  { slug: 'product-b', name: 'Product B', price: 100, salePrice: 80, images: [], status: 'active', variants: [] },
];

function makeWrapper(storageKey = 'test-cart') {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <CartProvider storageKey={storageKey} apiBaseUrl="https://api.test">
        {children}
      </CartProvider>
    );
  };
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useCartProducts', () => {
  it('returns empty array when cart is empty — no fetch fired', async () => {
    const { result } = renderHook(() => useCartProducts('test-empty.com'), { wrapper: makeWrapper() });
    expect(result.current.products).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fetches products when items are added to cart', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ products: mockProducts }),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), products: useCartProducts('test-fetch.com') }),
      { wrapper: makeWrapper() }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });

    await waitFor(() => expect(result.current.products.isLoading).toBe(false));

    expect(fetch).toHaveBeenCalledWith('https://api.test/api/public/products?domain=test-fetch.com');
    expect(result.current.products.products).toHaveLength(1);
    expect(result.current.products.products[0].slug).toBe('product-a');
    expect(result.current.products.products[0].price).toBe(230); // live price, not stored
    expect(result.current.products.products[0].quantity).toBe(1);
  });

  it('marks products as unavailable when missing from API response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ products: [] }), // API returns no products
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), products: useCartProducts('test-unavailable.com') }),
      { wrapper: makeWrapper() }
    );

    act(() => { result.current.cart.addItem('deleted-product', 1); });

    await waitFor(() => expect(result.current.products.isLoading).toBe(false));

    expect(result.current.products.products[0].status).toBe('unavailable');
    expect(result.current.products.products[0].slug).toBe('deleted-product');
  });

  it('sets error state when fetch fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(
      () => ({ cart: useCart(), products: useCartProducts('test-error.com') }),
      { wrapper: makeWrapper() }
    );

    act(() => { result.current.cart.addItem('product-a', 1); });

    await waitFor(() => expect(result.current.products.isLoading).toBe(false));

    expect(result.current.products.error).toBeInstanceOf(Error);
    expect(result.current.products.products).toEqual([]);
  });

  it('merges quantity from cart into CartProduct', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ products: mockProducts }),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), products: useCartProducts('test-quantity.com') }),
      { wrapper: makeWrapper() }
    );

    act(() => { result.current.cart.addItem('product-a', 3); });

    await waitFor(() => !result.current.products.isLoading);

    expect(result.current.products.products[0].quantity).toBe(3);
  });
});
