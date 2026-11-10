import type { AccountPresentationDto } from '@oyla/shared';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, errorCodeOf } from '../api/client';
import { Button, buttonClass } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { useI18n } from '../i18n/I18nProvider';
import { formatJoinCode } from '../lib/format';
import { forgetMine } from '../lib/my-presentations';
import { inputClass } from '../question-types/shared';
import { useAccount } from './AccountProvider';

export function AccountPresentations() {
  const account = useAccount();
  const { t } = useI18n();
  const [items, setItems] = useState<AccountPresentationDto[]>([]);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ReturnType<typeof errorCodeOf> | null>(null);
  const [version, setVersion] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version reloads the list after a claim
  useEffect(() => {
    if (!account.authenticated) {
      setItems([]);
      setLoaded(false);
      return;
    }
    let active = true;
    const load = () =>
      api
        .accountPresentations()
        .then((value) => {
          if (active) {
            setItems(value);
            setLoaded(true);
            setError(null);
          }
        })
        .catch((caught) => {
          if (active) {
            setError(errorCodeOf(caught));
            setLoaded(true);
          }
        });
    void load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [account.authenticated, version]);
  if (!account.authenticated) return null;
  const claim = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = new URL(link.trim());
      const id = /^\/edit\/([A-Za-z0-9_-]{1,32})$/.exec(url.pathname)?.[1];
      const key = /^#key=([A-Za-z0-9_-]{20,100})$/.exec(url.hash)?.[1];
      if (url.origin !== location.origin || !id || !key) {
        setError('VALIDATION_FAILED');
        return;
      }
      await api.claimPresentation(id, key);
      forgetMine(id);
      setLink('');
      setVersion((value) => value + 1);
    } catch (caught) {
      setError(errorCodeOf(caught));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{t('account.savedHint')}</p>
      {!loaded ? (
        <p>{t('common.loading')}</p>
      ) : !items.length ? (
        <p>{t('account.empty')}</p>
      ) : (
        <ul className="divide-y-2 divide-line border-y-2 border-line">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{item.title}</p>
                <p className="text-sm text-muted">{formatJoinCode(item.joinCode)}</p>
              </div>
              <Link to={`/edit/${item.id}`} className={buttonClass('secondary', 'md')}>
                {t('home.mine.open')}
              </Link>
              <Link to={`/present/${item.id}`} className={buttonClass('quiet', 'md')}>
                {t('home.mine.present')}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer font-medium">{t('account.import')}</summary>
        <form onSubmit={claim} className="mt-3 flex flex-col gap-3">
          <label htmlFor="account-import">{t('account.importHint')}</label>
          <input
            id="account-import"
            type="password"
            autoComplete="off"
            className={inputClass}
            value={link}
            onChange={(event) => setLink(event.target.value)}
            required
          />
          <p className="text-sm text-muted">{t('account.claimHint')}</p>
          <Button disabled={busy || !link.trim()} type="submit">
            {t('account.claim')}
          </Button>
        </form>
      </details>
      {error ? <ErrorNotice code={error} /> : null}
    </div>
  );
}
