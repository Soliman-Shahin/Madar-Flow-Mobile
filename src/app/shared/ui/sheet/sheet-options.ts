import type { ModalOptions } from '@ionic/angular';

/**
 * Presentation options for Calm Personal Ledger bottom sheets.
 *
 * - `ledgerFormSheet`: a tall, draggable sheet for create/edit forms.
 *   Dragging it down dismisses it (drafts are kept by the form itself).
 * - `ledgerDetailSheet`: a content-height sheet anchored to the bottom for
 *   read-only records; it grows with content up to 90% of the screen.
 *
 * Both are pure option objects: callers keep their own `component`,
 * `componentProps`, and dismissal handling.
 */
export function ledgerFormSheet(
  extra: Partial<ModalOptions> = {}
): Partial<ModalOptions> {
  return {
    breakpoints: [0, 0.94],
    initialBreakpoint: 0.94,
    handle: true,
    handleBehavior: 'none',
    // Size the content to the visible sheet so pinned actions stay on screen.
    expandToScroll: false,
    ...extra,
    cssClass: ['mf-sheet', 'mf-sheet--form', ...asList(extra.cssClass)],
  };
}

export function ledgerDetailSheet(
  extra: Partial<ModalOptions> = {}
): Partial<ModalOptions> {
  return {
    ...extra,
    cssClass: ['mf-sheet', 'mf-sheet--auto', ...asList(extra.cssClass)],
  };
}

function asList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : value.split(' ').filter(Boolean);
}
