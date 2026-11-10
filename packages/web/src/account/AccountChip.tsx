import { createElement, useEffect } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { useAccount } from './AccountProvider';

export function AccountChip() {
  const account = useAccount();
  const { language } = useI18n();
  useEffect(() => {
    if (!account.commonsUrl || document.querySelector('script[data-oyla-account]')) return;
    const script = document.createElement('script');
    script.src = `${account.commonsUrl}/assets/account-widget.js`;
    script.dataset.oylaAccount = '';
    script.defer = true;
    document.head.appendChild(script);
  }, [account.commonsUrl]);
  if (!account.enabled || !account.commonsUrl) return null;
  return createElement('edutictac-account', {
    'data-base': account.commonsUrl,
    'data-no-student': '',
    'data-home': 'https://edutictac.es/',
    'data-lang': language === 'ca-valencia' ? 'va' : language,
  });
}
