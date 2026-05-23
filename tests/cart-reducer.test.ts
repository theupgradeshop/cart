import { describe, it, expect } from 'vitest';
import { cartReducer, initialCartState } from '../src/cart-reducer';

describe('cartReducer — ADD_ITEM', () => {
  it('adds a new item', () => {
    const state = cartReducer(initialCartState, { type: 'ADD_ITEM', slug: 'product-a', quantity: 1 });
    expect(state.items).toEqual([{ slug: 'product-a', quantity: 1 }]);
  });

  it('increments quantity for existing item', () => {
    const state = cartReducer(
      { ...initialCartState, items: [{ slug: 'product-a', quantity: 1 }] },
      { type: 'ADD_ITEM', slug: 'product-a', quantity: 2 }
    );
    expect(state.items).toEqual([{ slug: 'product-a', quantity: 3 }]);
  });

  it('treats same slug with different variantId as separate entries', () => {
    let state = cartReducer(initialCartState, { type: 'ADD_ITEM', slug: 'product-a', quantity: 1, variantId: 'v1' });
    state = cartReducer(state, { type: 'ADD_ITEM', slug: 'product-a', quantity: 1, variantId: 'v2' });
    expect(state.items).toHaveLength(2);
    expect(state.items[0].variantId).toBe('v1');
    expect(state.items[1].variantId).toBe('v2');
  });

  it('increments correct variant when same slug exists with different variants', () => {
    const withV1 = { ...initialCartState, items: [{ slug: 'a', quantity: 1, variantId: 'v1' }] };
    const state = cartReducer(withV1, { type: 'ADD_ITEM', slug: 'a', quantity: 1, variantId: 'v1' });
    expect(state.items[0].quantity).toBe(2);
    expect(state.items).toHaveLength(1);
  });
});

describe('cartReducer — REMOVE_ITEM', () => {
  it('removes the matching item', () => {
    const state = cartReducer(
      { ...initialCartState, items: [{ slug: 'a', quantity: 1 }, { slug: 'b', quantity: 2 }] },
      { type: 'REMOVE_ITEM', slug: 'a' }
    );
    expect(state.items).toEqual([{ slug: 'b', quantity: 2 }]);
  });

  it('removes only the matching variant', () => {
    const state = cartReducer(
      { ...initialCartState, items: [{ slug: 'a', quantity: 1, variantId: 'v1' }, { slug: 'a', quantity: 1, variantId: 'v2' }] },
      { type: 'REMOVE_ITEM', slug: 'a', variantId: 'v1' }
    );
    expect(state.items).toEqual([{ slug: 'a', quantity: 1, variantId: 'v2' }]);
  });
});

describe('cartReducer — UPDATE_QUANTITY', () => {
  it('updates quantity', () => {
    const state = cartReducer(
      { ...initialCartState, items: [{ slug: 'a', quantity: 1 }] },
      { type: 'UPDATE_QUANTITY', slug: 'a', quantity: 5 }
    );
    expect(state.items[0].quantity).toBe(5);
  });

  it('removes item when quantity updated to 0', () => {
    const state = cartReducer(
      { ...initialCartState, items: [{ slug: 'a', quantity: 1 }] },
      { type: 'UPDATE_QUANTITY', slug: 'a', quantity: 0 }
    );
    expect(state.items).toEqual([]);
  });
});

describe('cartReducer — other actions', () => {
  it('CLEAR_CART empties items', () => {
    const state = cartReducer(
      { ...initialCartState, items: [{ slug: 'a', quantity: 1 }] },
      { type: 'CLEAR_CART' }
    );
    expect(state.items).toEqual([]);
  });

  it('OPEN_CART sets isOpen true', () => {
    const state = cartReducer(initialCartState, { type: 'OPEN_CART' });
    expect(state.isOpen).toBe(true);
  });

  it('TOGGLE_CART flips isOpen', () => {
    const open = cartReducer(initialCartState, { type: 'TOGGLE_CART' });
    expect(open.isOpen).toBe(true);
    const closed = cartReducer(open, { type: 'TOGGLE_CART' });
    expect(closed.isOpen).toBe(false);
  });

  it('LOAD_ITEMS replaces items array', () => {
    const state = cartReducer(
      { ...initialCartState, items: [{ slug: 'old', quantity: 1 }] },
      { type: 'LOAD_ITEMS', items: [{ slug: 'new', quantity: 2 }] }
    );
    expect(state.items).toEqual([{ slug: 'new', quantity: 2 }]);
  });
});
