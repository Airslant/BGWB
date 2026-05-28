"use client";

import { useEffect, useMemo, useState } from "react";

import { normalizeLocale, UI_COPY } from "@/lib/i18n";
import type { Locale } from "@/lib/types";

const STORAGE_KEY = "bgwb.locale";

export function useLocale() {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    setLocaleState(normalizeLocale(stored ?? window.navigator.language));
  }, []);

  function setLocale(nextLocale: Locale) {
    window.localStorage.setItem(STORAGE_KEY, nextLocale);
    setLocaleState(nextLocale);
  }

  return useMemo(
    () => ({
      locale,
      setLocale,
      t: UI_COPY[locale]
    }),
    [locale]
  );
}

export function LanguageSelect({
  locale,
  label,
  onChange
}: {
  locale: Locale;
  label: string;
  onChange: (locale: Locale) => void;
}) {
  return (
    <label className="language-select">
      <span>{label}</span>
      <select value={locale} onChange={(event) => onChange(event.target.value as Locale)}>
        <option value="en">English</option>
        <option value="zh-CN">中文</option>
      </select>
    </label>
  );
}
