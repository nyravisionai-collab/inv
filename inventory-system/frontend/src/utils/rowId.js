/**
 * Stable identity for dynamically added form rows.
 *
 * Editable row lists (invoice lines, journal lines, transfer items) must not be
 * keyed by array index: after a row is removed React re-uses the DOM nodes of
 * the following rows, so the focused input suddenly belongs to a different
 * row — the caret jumps and half-typed text appears on the wrong line. Giving
 * every row its own id keeps each input bound to its own data.
 */
let counter = 0;

export function newRowId() {
  counter += 1;
  return `row-${counter}`;
}

/** Attach an id to a freshly created row template. */
export function withRowId(row) {
  return { ...row, _rid: newRowId() };
}
