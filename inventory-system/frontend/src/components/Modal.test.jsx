import { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

afterEach(cleanup);

/**
 * Reproduces the reported bug: a modal whose `onClose` is an inline arrow
 * function re-created on every render. If the focus effect depends on that
 * identity it re-runs after each keystroke and steals focus back to the first
 * focusable element, so only the first typed character lands in the input.
 */
function TypingHost() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(true);
  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Add Customer"
      footer={<button type="button" onClick={() => setOpen(false)}>Cancel</button>}
    >
      <input aria-label="Name" value={value} onChange={(e) => setValue(e.target.value)} />
    </Modal>
  );
}

describe('Modal', () => {
  it('keeps focus in the input across every keystroke', async () => {
    const user = userEvent.setup();
    render(<TypingHost />);
    const input = screen.getByLabelText('Name');
    // Let the modal's queued initial-focus timer run before typing starts.
    await new Promise((r) => setTimeout(r, 10));

    input.focus();
    await user.type(input, 'Ramesh');

    expect(input).toHaveValue('Ramesh');
    expect(document.activeElement).toBe(input);
  });

  it('preserves Gujarati text typed into the field', async () => {
    const user = userEvent.setup();
    render(<TypingHost />);
    const input = screen.getByLabelText('Name');
    input.focus();
    await user.type(input, 'રમેશ');
    expect(input).toHaveValue('રમેશ');
    expect(document.activeElement).toBe(input);
  });

  it('does not move the caret to the end while editing mid-string', async () => {
    const user = userEvent.setup();
    render(<TypingHost />);
    const input = screen.getByLabelText('Name');
    input.focus();
    await user.type(input, 'abcd');
    // userEvent moves the caret to the end on a fresh type() unless told
    // where to start, so state the insertion point explicitly.
    await user.type(input, 'X', { initialSelectionStart: 2, initialSelectionEnd: 2 });
    expect(input).toHaveValue('abXcd');
    expect(document.activeElement).toBe(input);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T"><input aria-label="F" /></Modal>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the overlay itself is pressed', async () => {
    const onClose = vi.fn();
    const { container } = render(<Modal open onClose={onClose} title="T"><input aria-label="F" /></Modal>);
    await userEvent.click(container.querySelector('.modal-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when the dialog body is clicked', async () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="T"><input aria-label="F" /></Modal>);
    await userEvent.click(screen.getByLabelText('F'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('gives initial focus to an autoFocus field rather than the close button', async () => {
    render(
      <Modal open onClose={() => {}} title="T">
        <input aria-label="First" autoFocus />
      </Modal>
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(document.activeElement).toBe(screen.getByLabelText('First'));
  });

  it('restores body scrolling only after the last modal closes', async () => {
    const { rerender } = render(
      <>
        <Modal open onClose={() => {}} title="A"><input aria-label="a" /></Modal>
        <Modal open onClose={() => {}} title="B"><input aria-label="b" /></Modal>
      </>
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        <Modal open onClose={() => {}} title="A"><input aria-label="a" /></Modal>
        <Modal open={false} onClose={() => {}} title="B"><input aria-label="b" /></Modal>
      </>
    );
    // One modal is still open — the page behind must stay locked.
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <>
        <Modal open={false} onClose={() => {}} title="A"><input aria-label="a" /></Modal>
        <Modal open={false} onClose={() => {}} title="B"><input aria-label="b" /></Modal>
      </>
    );
    expect(document.body.style.overflow).toBe('');
  });
});
