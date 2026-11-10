import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { useCopy } from './useCopy';

function CopyButton({ text }: { text: string }) {
  const [copied, copy] = useCopy();
  return (
    <button type="button" onClick={() => copy(text)}>
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  vi.restoreAllMocks();
  if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
  else Reflect.deleteProperty(navigator, 'clipboard');
  Reflect.deleteProperty(document, 'execCommand');
});

describe('useCopy', () => {
  test('falls back to execCommand when the Clipboard API is missing', () => {
    Reflect.deleteProperty(navigator, 'clipboard');
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    render(<CopyButton text="join-link" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  test('uses the Clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<CopyButton text="admin-link" />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).toHaveBeenCalledWith('admin-link');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});
