"use client";

import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { withBasePath } from "@/lib/base-path";

import { BggAttribution } from "./bgg-branding";
import { BrandHeroImage } from "./brand-hero-image";
import { LanguageSelect, useLocale } from "./use-locale";

export function HomeClient() {
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      try {
        const response = await fetch(withBasePath("/api/auth/me"));
        const payload = (await response.json()) as { user?: unknown };

        if (!cancelled && payload.user) {
          router.replace("/boards");
          return;
        }
      } finally {
        if (!cancelled) {
          setIsChecking(false);
        }
      }
    }

    void checkSession();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="home-shell">
      <BrandHeroImage priority />
      <section className="home-panel" aria-labelledby="home-title">
        <div className="home-topline">
          <LanguageSelect label={t.language} locale={locale} onChange={setLocale} />
        </div>
        <div className="home-kicker">
          <Sparkles size={16} />
          {t.appKicker}
        </div>
        <h1 id="home-title">{t.appTitle}</h1>
        <p className="home-copy">{t.appDescription}</p>

        <div className="home-actions">
          <Link className="button primary" href="/login">
            {isChecking ? <Loader2 className="spin" size={18} /> : null}
            {t.login}
          </Link>
          <Link className="button secondary" href="/register">
            {t.register}
          </Link>
        </div>
      </section>

      <footer className="bgg-credit">
        <BggAttribution />
      </footer>
    </main>
  );
}
