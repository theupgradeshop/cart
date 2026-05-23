import { CartState, CartAction } from './types';

/** Unique key per cart line — same slug+variant = same line */
export function itemKey(slug: string, variantId?: string): string {
  return variantId ? `${slug}::${variantId}` : slug;
}

export const initialCartState: CartState = { items: [], isOpen: false };

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const key = itemKey(action.slug, action.variantId);
      const existing = state.items.find(i => itemKey(i.slug, i.variantId) === key);
      if (existing) {
        return {
          ...state,
          items: state.items.map(i =>
            itemKey(i.slug, i.variantId) === key
              ? { ...i, quantity: i.quantity + action.quantity }
              : i
          ),
        };
      }
      return {
        ...state,
        items: [
          ...state.items,
          { slug: action.slug, quantity: action.quantity, ...(action.variantId ? { variantId: action.variantId } : {}) },
        ],
      };
    }

    case 'REMOVE_ITEM': {
      const key = itemKey(action.slug, action.variantId);
      return { ...state, items: state.items.filter(i => itemKey(i.slug, i.variantId) !== key) };
    }

    case 'UPDATE_QUANTITY': {
      const key = itemKey(action.slug, action.variantId);
      if (action.quantity <= 0) {
        return { ...state, items: state.items.filter(i => itemKey(i.slug, i.variantId) !== key) };
      }
      return {
        ...state,
        items: state.items.map(i =>
          itemKey(i.slug, i.variantId) === key ? { ...i, quantity: action.quantity } : i
        ),
      };
    }

    case 'CLEAR_CART':
      return { ...state, items: [] };

    case 'OPEN_CART':
      return { ...state, isOpen: true };

    case 'CLOSE_CART':
      return { ...state, isOpen: false };

    case 'TOGGLE_CART':
      return { ...state, isOpen: !state.isOpen };

    case 'LOAD_ITEMS':
      return { ...state, items: action.items };

    default:
      return state;
  }
}
