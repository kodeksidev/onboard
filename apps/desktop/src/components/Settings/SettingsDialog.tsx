import { useEffect, useRef } from 'react';
import type { JSX, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { SETTINGS_COPY } from '@/copy/messages';
import { AiSettingsSection } from './AiSettingsSection';
import { EngineVersionFooter } from './EngineVersionFooter';

export interface SettingsDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

/** Escape closes the dialog; focus moves to it on open. Extracted so the
 * component body stays under the file's line-per-function limit. */
function useDialogEscapeAndFocus(
  isOpen: boolean,
  onClose: () => void,
  dialogRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      dialogRef.current?.focus();
    }
  }, [isOpen, dialogRef]);
}

function DialogHeader({ onClose }: { readonly onClose: () => void }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <h2 id="settings-dialog-title" className="text-lg font-semibold">
        {SETTINGS_COPY.dialogTitle}
      </h2>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClose}
        aria-label={SETTINGS_COPY.closeLabel}
      >
        ✕
      </Button>
    </div>
  );
}

/**
 * A minimal, self-contained modal (no portal — this app's single-window
 * frame has no `overflow: hidden` ancestor for a fixed-position overlay to
 * escape, per `AppShell`'s `flex h-screen flex-col` layout). `role="dialog"`
 * + `aria-modal="true"` + a labelled heading; Escape and a backdrop click
 * both close it; focus moves to the dialog on open.
 */
export function SettingsDialog({ isOpen, onClose }: SettingsDialogProps): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialogEscapeAndFocus(isOpen, onClose, dialogRef);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-md flex-col gap-4 overflow-auto rounded-lg bg-white p-6 shadow-lg dark:bg-slate-900"
      >
        <DialogHeader onClose={onClose} />
        <AiSettingsSection />
        <EngineVersionFooter />
      </div>
    </div>
  );
}
