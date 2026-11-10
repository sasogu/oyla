import type { AccountPresentationDto } from '@oyla/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, errorCodeOf } from '../api/client';
import { buttonClass } from '../components/Button';
import { ErrorNotice } from '../components/ErrorNotice';
import { useI18n } from '../i18n/I18nProvider';
import { formatJoinCode } from '../lib/format';
import { useAccount } from './AccountProvider';

export function AccountPresentations() {
  const account = useAccount();
  const { t } = useI18n();
  const [items, setItems] = useState<AccountPresentationDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<ReturnType<typeof errorCodeOf> | null>(null);
  useEffect(() => {
    if (!account.authenticated) {
      setItems([]);
      setLoaded(false);
      setError(null);
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
  }, [account.authenticated]);
  if (!account.authenticated) return null;
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
      {error ? <ErrorNotice code={error} /> : null}
    </div>
  );
}
