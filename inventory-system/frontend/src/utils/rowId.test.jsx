import { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { withRowId, newRowId } from './rowId';

afterEach(cleanup);

const emptyLine = { name: '', qty: 1 };

/**
 * Minimal stand-in for the editable line tables used by Sales, Purchases,
 * Journals, Stock Transfer and Stock Adjustment. Keyed by a stable row id, the
 * way those pages now do it.
 */
function RowList({ keyBy }) {
  const [rows, setRows] = useState(() => [
    withRowId({ ...emptyLine, name: 'first' }),
    withRowId({ ...emptyLine, name: 'second' }),
    withRowId({ ...emptyLine, name: 'third' }),
  ]);

  const update = (idx, patch) =>
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <div>
      {rows.map((row, idx) => (
        <div key={keyBy === 'index' ? idx : row._rid} data-testid="row">
          <input
            aria-label={`name-${row._rid}`}
            value={row.name}
            onChange={(e) => update(idx, { name: e.target.value })}
          />
          <button type="button" onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}>
            {`remove-${row.name}`}
          </button>
        </div>
      ))}
    </div>
  );
}

describe('dynamic row identity', () => {
  it('issues a unique id per row', () => {
    const ids = new Set([newRowId(), newRowId(), newRowId()]);
    expect(ids.size).toBe(3);
  });

  it('keeps each input bound to its own row after a middle row is deleted', async () => {
    const user = userEvent.setup();
    render(<RowList keyBy="rid" />);

    expect(screen.getAllByTestId('row')).toHaveLength(3);
    await user.click(screen.getByText('remove-second'));

    const rows = screen.getAllByTestId('row');
    expect(rows).toHaveLength(2);
    // The surviving rows must still carry their own values — with index keys
    // React re-uses DOM nodes and the third row would render the second's data.
    expect(within(rows[0]).getByRole('textbox')).toHaveValue('first');
    expect(within(rows[1]).getByRole('textbox')).toHaveValue('third');
  });

  it('keeps the same DOM node for a row when an earlier row is removed', async () => {
    const user = userEvent.setup();
    render(<RowList keyBy="rid" />);

    const rowsBefore = screen.getAllByTestId('row');
    const thirdInput = within(rowsBefore[2]).getByRole('textbox');

    await user.click(screen.getByText('remove-first'));

    const rowsAfter = screen.getAllByTestId('row');
    // Stable keys let React move the existing node instead of re-purposing a
    // sibling's node, which is exactly what preserves focus and caret position
    // for whichever field the user was typing in.
    expect(within(rowsAfter[1]).getByRole('textbox')).toBe(thirdInput);
    expect(thirdInput).toHaveValue('third');

    // Focus survives a re-render that is not caused by clicking elsewhere.
    thirdInput.focus();
    await user.type(thirdInput, '!');
    expect(document.activeElement).toBe(thirdInput);
    expect(thirdInput).toHaveValue('third!');
  });

  it('edits only the targeted row', async () => {
    const user = userEvent.setup();
    render(<RowList keyBy="rid" />);
    const rows = screen.getAllByTestId('row');
    await user.type(within(rows[1]).getByRole('textbox'), 'X');
    expect(within(rows[0]).getByRole('textbox')).toHaveValue('first');
    expect(within(rows[1]).getByRole('textbox')).toHaveValue('secondX');
    expect(within(rows[2]).getByRole('textbox')).toHaveValue('third');
  });
});
