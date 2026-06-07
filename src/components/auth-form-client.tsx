"use client";

import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { withBasePath } from "@/lib/base-path";

import { BggAttribution } from "./bgg-branding";
import { BrandHeroImage } from "./brand-hero-image";
import { LanguageSelect, useLocale } from "./use-locale";

type AuthFormClientProps = {
  mode: "login" | "register";
};

export function AuthFormClient({ mode }: AuthFormClientProps) {
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isRegister = mode === "register";

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
      const response = await fetch(withBasePath("/api/auth/register/code"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email })
      });
      const payload = (await response.json()) as { error?: string; cooldownSeconds?: number };

      if (!response.ok) {
        throw new Error(payload.error ?? t.authFailed);
      }

      setCodeCooldown(payload.cooldownSeconds ?? 60);
      setMessage(t.codeSent);
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

    if (isRegister && password !== confirmPassword) {
      setError(t.passwordMismatch);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(withBasePath(`/api/auth/${mode}`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(isRegister ? { email, nickname, password, code } : { email, password })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? t.authFailed);
      }

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
      <section className="auth-panel" aria-labelledby="auth-title">
        <LanguageSelect label={t.language} locale={locale} onChange={setLocale} />
        <h1 id="auth-title">{isRegister ? t.registerTitle : t.loginTitle}</h1>
        <p>{isRegister ? t.registerIntro : t.loginIntro}</p>

        <form className="auth-form" onSubmit={submit}>
          {isRegister ? (
            <label>
              <span>{t.nickname}</span>
              <input
                autoComplete="nickname"
                maxLength={20}
                type="text"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
              />
            </label>
          ) : null}

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
            <span>{t.password}</span>
            <input
              autoComplete={isRegister ? "new-password" : "current-password"}
              minLength={8}
              type={isPasswordVisible ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          {isRegister ? (
            <label>
              <span>{t.confirmPassword}</span>
              <input
                autoComplete="new-password"
                minLength={8}
                type={isPasswordVisible ? "text" : "password"}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
          ) : null}

          <button
            aria-label={isPasswordVisible ? t.hidePassword : t.showPassword}
            className="password-visibility-inline button secondary"
            type="button"
            onClick={() => setIsPasswordVisible((isVisible) => !isVisible)}
          >
            {isPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            {isPasswordVisible ? t.hidePassword : t.showPassword}
          </button>

          {isRegister ? (
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
          ) : null}

          <button className="button primary" disabled={isSubmitting} type="submit">
            {isSubmitting ? <Loader2 className="spin" size={18} /> : null}
            {isRegister ? t.register : t.login}
          </button>
        </form>

        {error ? <p className="error-text">{error}</p> : null}
        {message ? <p className="success-text">{message}</p> : null}

        <p className="auth-switch">
          {isRegister ? t.haveAccount : t.needAccount}{" "}
          <Link href={isRegister ? "/login" : "/register"}>{isRegister ? t.login : t.register}</Link>
        </p>
        {!isRegister ? (
          <p className="auth-switch">
            <Link href="/forgot-password">{t.forgotPassword}</Link>
          </p>
        ) : null}
      </section>

      <footer className="bgg-credit">
        <BggAttribution />
      </footer>
    </main>
  );
}
