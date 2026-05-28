"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { withBasePath } from "@/lib/base-path";

import { BggAttribution } from "./bgg-branding";
import { BrandHeroImage } from "./brand-hero-image";
import { LanguageSelect, useLocale } from "./use-locale";

export function PasswordResetClient() {
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);

  useEffect(() => {
    if (codeCooldown <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setCodeCooldown((currentValue) => Math.max(0, currentValue - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [codeCooldown]);

  async function sendCode() {
    setError("");
    setMessage("");
    setIsSendingCode(true);

    try {
      const response = await fetch(withBasePath("/api/auth/password-reset/code"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
      });
      const payload = (await response.json()) as { error?: string; message?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? t.authFailed);
      }

      setCodeCooldown(60);
      setMessage(payload.message ?? t.resetPasswordSent);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.authFailed);
    } finally {
      setIsSendingCode(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSubmitting(true);

    try {
      const response = await fetch(withBasePath("/api/auth/password-reset/confirm"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password, code })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? t.authFailed);
      }

      setMessage(t.resetPasswordDone);
      router.push("/boards");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.authFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <BrandHeroImage />
      <section className="auth-panel" aria-labelledby="reset-title">
        <LanguageSelect label={t.language} locale={locale} onChange={setLocale} />
        <h1 id="reset-title">{t.forgotPasswordTitle}</h1>
        <p>{t.forgotPasswordIntro}</p>

        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>{t.email}</span>
            <input
              autoComplete="email"
              inputMode="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>

          <label>
            <span>{t.verificationCode}</span>
            <div className="auth-code-row">
              <input
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                pattern="[0-9]{6}"
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              />
              <button className="button secondary" disabled={isSendingCode || codeCooldown > 0} type="button" onClick={sendCode}>
                {isSendingCode ? <Loader2 className="spin" size={18} /> : null}
                {codeCooldown > 0 ? `${codeCooldown}s` : code ? t.resendCode : t.sendCode}
              </button>
            </div>
            <small>{t.codeHint}</small>
          </label>

          <label>
            <span>{t.newPassword}</span>
            <input
              autoComplete="new-password"
              minLength={8}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <button className="button primary" disabled={isSubmitting} type="submit">
            {isSubmitting ? <Loader2 className="spin" size={18} /> : null}
            {t.resetPassword}
          </button>
        </form>

        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p className="success-text">{message}</p> : null}

        <p className="auth-switch">
          <Link href="/login">{t.login}</Link>
        </p>
      </section>

      <footer className="bgg-credit">
        <BggAttribution />
      </footer>
    </main>
  );
}
