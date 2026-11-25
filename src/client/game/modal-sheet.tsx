import { useLayoutEffect, useRef, type ReactNode } from 'react';

interface ModalSheetProps {
  children: ReactNode;
  titleId: string;
  onDismiss?: () => void;
}

export function ModalSheet({ children, titleId, onDismiss }: ModalSheetProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    document.getElementById(titleId)?.focus({ preventScroll: true });
    return () => dialog.close();
  }, [titleId]);

  return (
    <dialog
      ref={ref}
      className="sheet sheet--modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss?.();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss?.();
      }}
    >
      {children}
    </dialog>
  );
}
