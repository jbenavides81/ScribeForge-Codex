import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A modal dialog. Focus moves into it when it opens, Tab stays inside it, Escape cancels, and
 * focus returns to where it was when it closes.
 */
export function Dialog({
  title,
  children,
  onCancel,
  testId,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  testId?: string;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const box = ref.current;
    const first = box?.querySelector<HTMLElement>('input, button, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    return () => previous?.focus();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
      return;
    }
    if (event.key !== 'Tab' || !ref.current) return;
    const focusable = [...ref.current.querySelectorAll<HTMLElement>('input, button, select, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.hasAttribute('disabled'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="sf-scrim">
      <div
        ref={ref}
        className="sf-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        data-testid={testId}
      >
        <h2 id={titleId} className="sf-dialog-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
