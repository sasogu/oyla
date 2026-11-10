import { useRef, useState } from 'react';
import { errorCodeOf } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';
import { Button } from './Button';
import { ErrorNotice } from './ErrorNotice';

export function RestartPresentationButton({
  onRestart,
  disabled = false,
}: {
  onRestart(): Promise<void>;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ReturnType<typeof errorCodeOf> | null>(null);
  const restart = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onRestart();
      dialog.current?.close();
    } catch (caught) {
      setError(errorCodeOf(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          setError(null);
          dialog.current?.showModal();
        }}
      >
        {t('presentation.restart')}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="restart-presentation-title"
        aria-describedby="restart-presentation-body"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        className="m-auto max-h-[90dvh] w-[min(32rem,calc(100%_-_2rem))] overflow-y-auto rounded-2xl border-2 border-line bg-paper p-6 text-base text-ink backdrop:bg-black/50"
      >
        <h2 id="restart-presentation-title" className="text-2xl font-semibold">
          {t('presentation.restart')}
        </h2>
        <p id="restart-presentation-body" className="my-4">
          {t('presentation.restart.hint')}
        </p>
        {error ? <ErrorNotice code={error} /> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => dialog.current?.close()}>
            {t('presentation.restart.cancel')}
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void restart()}>
            {busy ? t('common.loading') : t('presentation.restart.confirm')}
          </Button>
        </div>
      </dialog>
    </>
  );
}
