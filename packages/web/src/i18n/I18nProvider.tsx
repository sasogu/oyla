import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { readJson, writeJson } from '../lib/storage';
import { ca } from './ca';
import { caValencia } from './ca-valencia';
import { de } from './de';
import { en, type MessageKey } from './en';
import { es } from './es';
import { tr } from './tr';

export const LANGUAGES = {
  es: 'Español',
  ca: 'Català',
  'ca-valencia': 'Valencià',
  en: 'English',
  tr: 'Türkçe',
  de: 'Deutsch',
} as const;
export type Language = keyof typeof LANGUAGES;

const dictionaries: Record<Language, Record<MessageKey, string>> = {
  es,
  ca,
  'ca-valencia': caValencia,
  en,
  tr,
  de,
};
const STORAGE_KEY = 'oyla:language';

type Vars = Record<string, string | number>;
type PluralBase = MessageKey extends infer K ? (K extends `${infer B}.one` ? B : never) : never;

export interface I18n {
  language: Language;
  setLanguage(language: Language): void;
  /** Translates a key and fills `{name}` placeholders. */
  t(key: MessageKey, vars?: Vars): string;
  /** Picks the `.one` or `.other` form for `count` and fills `{count}`. */
  tn(base: PluralBase, count: number, vars?: Vars): string;
  /** Like `t`, but placeholders can be React nodes (for styled parts of a sentence). */
  tRich(key: MessageKey, nodes: Record<string, ReactNode>): ReactNode[];
}

export function detectLanguage(): Language {
  const shared =
    typeof document === 'undefined'
      ? null
      : document.cookie
          .split('; ')
          .find((part) => part.startsWith('edutictac_language='))
          ?.split('=')[1];
  if (shared === 'va') return 'ca-valencia';
  if (shared && Object.hasOwn(LANGUAGES, shared)) return shared as Language;

  const stored = readJson<unknown>(STORAGE_KEY, null);
  if (typeof stored === 'string' && Object.hasOwn(LANGUAGES, stored)) {
    return stored as Language;
  }
  const preferred =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  for (const tag of preferred) {
    if (!tag) continue;
    const lower = tag.toLowerCase();
    if (Object.hasOwn(LANGUAGES, lower)) return lower as Language;
    const code = lower.split('-')[0];
    if (code && Object.hasOwn(LANGUAGES, code)) return code as Language;
  }
  return 'en';
}

export function interpolate(template: string, vars: Vars = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function createTranslator(language: Language): Omit<I18n, 'language' | 'setLanguage'> {
  const dictionary = dictionaries[language];
  const t = (key: MessageKey, vars?: Vars) => interpolate(dictionary[key] ?? en[key], vars);
  return {
    t,
    tn: (base, count, vars) =>
      t(`${base}.${count === 1 ? 'one' : 'other'}` as MessageKey, { count, ...vars }),
    tRich: (key, nodes) =>
      (dictionary[key] ?? en[key]).split(/(\{\w+\})/).map((part) => {
        const name = /^\{(\w+)\}$/.exec(part)?.[1];
        return name && name in nodes ? nodes[name] : part;
      }),
  };
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Language }) {
  const [language, setLanguageState] = useState<Language>(() => initial ?? detectLanguage());

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    writeJson(STORAGE_KEY, next);
    setLanguageState(next);
    if (location.hostname === 'edutictac.es' || location.hostname.endsWith('.edutictac.es')) {
      // biome-ignore lint/suspicious/noDocumentCookie: shared preference must also work in browsers without Cookie Store
      document.cookie = `edutictac_language=${next === 'ca-valencia' ? 'va' : next}; Domain=.edutictac.es; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    }
    window.dispatchEvent(new CustomEvent('edutictac:langchange'));
  }, []);

  useEffect(() => {
    const host = window as Window & {
      edutictacLanguage?: { languages: string[]; get(): string; set(language: string): void };
    };
    host.edutictacLanguage = {
      languages: ['ca', 'va', 'es', 'en'],
      get: () => (language === 'ca-valencia' ? 'va' : language),
      set: (next) => {
        const code = next === 'va' ? 'ca-valencia' : next;
        if (Object.hasOwn(LANGUAGES, code)) setLanguage(code as Language);
      },
    };
    return () => {
      delete host.edutictacLanguage;
    };
  }, [language, setLanguage]);

  const value = useMemo<I18n>(
    () => ({ language, setLanguage, ...createTranslator(language) }),
    [language, setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside I18nProvider');
  return context;
}
