import type { AccountSessionDto } from '@oyla/shared';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { api } from '../api/client';

const initial: AccountSessionDto = {
  enabled: false,
  authenticated: false,
  displayName: '',
  commonsUrl: null,
  loginUrl: null,
};
const AccountContext = createContext({ ...initial, loading: true, failed: false });

export function AccountProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState({ ...initial, loading: true, failed: false });
  useEffect(() => {
    let active = true;
    const refresh = () => {
      api
        .accountSession()
        .then((session) => {
          if (active) setState({ ...session, loading: false, failed: false });
        })
        .catch(() => {
          if (active)
            setState((current) => ({
              ...current,
              authenticated: false,
              loading: false,
              failed: true,
            }));
        });
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('edutictac:sessionchange', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('edutictac:sessionchange', refresh);
    };
  }, []);
  return <AccountContext.Provider value={state}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  return useContext(AccountContext);
}
