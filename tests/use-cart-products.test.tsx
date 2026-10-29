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
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ products: [] }), // API returns no products
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Product not found' }), // single-product fallback also misses
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

  it('falls back to the single-product endpoint when a slug is missing from the catalog (hide_from_shop)', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ products: [] }), // catalog excludes hidden products
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          product: {
            slug: 'hidden-product',
            name: 'Hidden Product',
            price: 55,
            salePrice: null,
            images: [{ url: '/hidden.jpg', alt: 'Hidden' }],
            status: 'active',
            variants: [],
          },
        }),
      } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), products: useCartProducts('test-hidden.com') }),
      { wrapper: makeWrapper() }
    );

    act(() => { result.current.cart.addItem('hidden-product', 1); });

    await waitFor(() => expect(result.current.products.isLoading).toBe(false));

    expect(fetch).toHaveBeenCalledWith('https://api.test/api/public/products?domain=test-hidden.com');
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/api/public/products/hidden-product?domain=test-hidden.com'
    );
    expect(result.current.products.products).toHaveLength(1);
    expect(result.current.products.products[0].status).toBe('active');
    expect(result.current.products.products[0].price).toBe(55);
    expect(result.current.products.products[0].name).toBe('Hidden Product');
  });

  it('degrades to unavailable when the single-product fallback also fails', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ products: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Product not found' }),
      } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), products: useCartProducts('test-hidden-404.com') }),
      { wrapper: makeWrapper() }
    );

    act(() => { result.current.cart.addItem('truly-missing-product', 1); });

    await waitFor(() => expect(result.current.products.isLoading).toBe(false));

    expect(result.current.products.products[0].status).toBe('unavailable');
    expect(result.current.products.products[0].price).toBe(0);
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

    await waitFor(() => expect(result.current.products.isLoading).toBe(false));

    expect(result.current.products.products[0].quantity).toBe(3);
  });
});

describe('useCartProducts: physical-product fields', () => {
  it('passes product_type and contains_physical_product through from the catalog list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        products: [
          { slug: 'shirt', name: 'Shirt', price: 100, salePrice: null, images: [], status: 'active', variants: [], product_type: 'physical', contains_physical_product: false },
          { slug: 'kit', name: 'Kit', price: 100, salePrice: null, images: [], status: 'active', variants: [], product_type: 'bundle', contains_physical_product: true },
          { slug: 'guide', name: 'Guide', price: 100, salePrice: null, images: [], status: 'active', variants: [] },
        ],
      }),
    } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), products: useCartProducts('test-physical.com') }),
      { wrapper: makeWrapper('test-physical') }
    );
    act(() => {
      result.current.cart.addItem('shirt', 1);
      result.current.cart.addItem('kit', 1);
      result.current.cart.addItem('guide', 1);
    });
    await waitFor(() => expect(result.current.products.products).toHaveLength(3));

    const bySlug = Object.fromEntries(result.current.products.products.map(p => [p.slug, p]));
    expect(bySlug.shirt).toMatchObject({ product_type: 'physical', contains_physical_product: false });
    expect(bySlug.kit).toMatchObject({ product_type: 'bundle', contains_physical_product: true });
    expect(bySlug.guide).toMatchObject({ product_type: null, contains_physical_product: false });
  });

  it('reads the single-product fallback camelCase names into the same shape', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ products: [] }) } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ product: { slug: 'hidden', name: 'Hidden', price: 50, salePrice: null, images: [], variants: [], productType: 'physical', containsPhysicalProduct: true } }),
      } as Response);

    const { result } = renderHook(
      () => ({ cart: useCart(), products: useCartProducts('test-physical-fallback.com') }),
      { wrapper: makeWrapper('test-physical-fallback') }
    );
    act(() => { result.current.cart.addItem('hidden', 1); });
    await waitFor(() => expect(result.current.products.products).toHaveLength(1));
    expect(result.current.products.products[0]).toMatchObject({ product_type: 'physical', contains_physical_product: true });
  });
});
