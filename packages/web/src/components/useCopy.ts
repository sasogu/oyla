import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Copies text with the async Clipboard API when available. That API only exists in secure
 * contexts (HTTPS or localhost), so plain-HTTP access such as the Tailnet address falls back to
 * the old `execCommand` trick with a temporary textarea.
 */
function legacyCopy(text: string): boolean {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

/** Copies text and reports `copied` for a moment, for "Copy" → "Copied" buttons. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = useCallback((text: string) => {
    const done = () => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    };
    const fail = () => setCopied(false);

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, () => {
        if (legacyCopy(text)) done();
        else fail();
      });
      return;
    }
    if (legacyCopy(text)) done();
    else fail();
  }, []);
  return [copied, copy];
}
