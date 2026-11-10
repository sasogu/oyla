import { buttonClass } from '../components/Button';
import { useI18n } from '../i18n/I18nProvider';
import { useAccount } from './AccountProvider';

export function AccountNotice() {
  const account = useAccount();
  const { t } = useI18n();
  if (account.loading) return <p>{t('common.loading')}</p>;
  if (account.failed) return <p role="alert">{t('account.unavailable')}</p>;
  if (!account.enabled || account.authenticated) return null;
  const login = account.commonsUrl
    ? `${account.commonsUrl}/api/auth/oidc/login?next=${encodeURIComponent(`${location.origin}${location.pathname}`)}`
    : account.loginUrl;
  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-line bg-paper p-4">
      <p>{t('account.signInHint')}</p>
      {login ? (
        <a href={login} className={buttonClass('primary', 'md')}>
          {t('account.signIn')}
        </a>
      ) : null}
    </div>
  );
}
