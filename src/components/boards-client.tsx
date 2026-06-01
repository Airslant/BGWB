"use client";

import { KeyRound, Loader2, LogOut, Pencil, Plus, Share2, Trash2, UserCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { withBasePath } from "@/lib/base-path";
import type { Board, BoardSummary, User } from "@/lib/types";

import { LanguageSelect, useLocale } from "./use-locale";

export function BoardsClient() {
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const [user, setUser] = useState<User | null>(null);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isNameSubmitting, setIsNameSubmitting] = useState(false);
  const [nameDialog, setNameDialog] = useState<{ mode: "create" } | { mode: "rename"; board: BoardSummary } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BoardSummary | null>(null);
  const [boardName, setBoardName] = useState("");
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [accountNickname, setAccountNickname] = useState("");
  const [accountPasswordForm, setAccountPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: ""
  });
  const [accountDeletePassword, setAccountDeletePassword] = useState("");
  const [accountMessage, setAccountMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [accountSubmitting, setAccountSubmitting] = useState<"nickname" | "password" | "delete" | null>(null);

  async function loadBoards() {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(withBasePath("/api/auth/me"));
      const me = (await response.json()) as { user?: User | null };

      if (!me.user) {
        router.replace("/login");
        return;
      }

      setUser(me.user);

      const boardsResponse = await fetch(withBasePath("/api/boards"));
      const payload = (await boardsResponse.json()) as { boards?: BoardSummary[]; maxBoards?: number; error?: string };

      if (!boardsResponse.ok) {
        throw new Error(payload.error ?? t.loadBoardsFailed);
      }

      setBoards(payload.boards ?? []);
      if (typeof payload.maxBoards === "number") {
        setUser((currentUser) => (currentUser ? { ...currentUser, maxBoards: payload.maxBoards ?? currentUser.maxBoards } : currentUser));
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.loadBoardsFailed);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadBoards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openCreateDialog() {
    if (user && boards.length >= user.maxBoards) {
      setError(t.boardLimitReached.replace("{limit}", String(user.maxBoards)));
      return;
    }

    setError("");
    setBoardName("");
    setNameDialog({ mode: "create" });
  }

  function openRenameDialog(board: BoardSummary) {
    setError("");
    setBoardName(board.title);
    setNameDialog({ mode: "rename", board });
  }

  function openAccountDialog() {
    setAccountNickname(user?.nickname ?? "");
    setAccountPasswordForm({
      currentPassword: "",
      newPassword: "",
      confirmPassword: ""
    });
    setAccountDeletePassword("");
    setAccountMessage(null);
    setIsAccountOpen(true);
  }

  async function submitBoardName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsNameSubmitting(true);
    const title = boardName.trim().slice(0, 20);

    if (!title) {
      setError(t.boardNameRequired);
      setIsNameSubmitting(false);
      return;
    }

    try {
      if (nameDialog?.mode === "rename") {
        const response = await fetch(withBasePath(`/api/boards/${nameDialog.board.id}?locale=${encodeURIComponent(locale)}`), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ title })
        });
        const payload = (await response.json()) as { board?: Board; error?: string };

        if (!response.ok || !payload.board) {
          throw new Error(payload.error ?? t.createFailed);
        }

        const renamedBoard = payload.board;
        setBoards((currentBoards) =>
          currentBoards.map((board) =>
            board.id === renamedBoard.id
              ? {
                  ...board,
                  title: renamedBoard.title,
                  updatedAt: renamedBoard.updatedAt
                }
              : board
          )
        );
        setNameDialog(null);
        return;
      }

      const response = await fetch(withBasePath(`/api/boards?locale=${encodeURIComponent(locale)}`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ title })
      });
      const payload = (await response.json()) as { board?: BoardSummary; error?: string };

      if (!response.ok || !payload.board) {
        throw new Error(payload.error ?? t.createFailed);
      }

      router.push(`/board/${payload.board.id}`);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.createFailed);
    } finally {
      setIsNameSubmitting(false);
    }
  }

  async function confirmDeleteBoard() {
    if (!deleteTarget) {
      return;
    }

    setError("");

    try {
      const response = await fetch(withBasePath(`/api/boards/${deleteTarget.id}`), { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? t.deleteBoardFailed);
      }

      setBoards((currentBoards) => currentBoards.filter((board) => board.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : t.deleteBoardFailed);
    }
  }

  async function logout() {
    await fetch(withBasePath("/api/auth/logout"), { method: "POST" });
    router.push("/login");
  }

  async function submitNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountMessage(null);
    setAccountSubmitting("nickname");

    const nickname = accountNickname.trim().slice(0, 20);

    if (!nickname) {
      setAccountMessage({ type: "error", text: t.nicknameRequired });
      setAccountSubmitting(null);
      return;
    }

    try {
      const response = await fetch(withBasePath("/api/auth/me"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ nickname })
      });
      const payload = (await response.json()) as { user?: User; error?: string };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? t.accountUpdateFailed);
      }

      setUser(payload.user);
      setAccountNickname(payload.user.nickname);
      setAccountMessage({ type: "success", text: t.nicknameUpdated });
    } catch (caughtError) {
      setAccountMessage({ type: "error", text: caughtError instanceof Error ? caughtError.message : t.accountUpdateFailed });
    } finally {
      setAccountSubmitting(null);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountMessage(null);
    setAccountSubmitting("password");

    if (accountPasswordForm.newPassword !== accountPasswordForm.confirmPassword) {
      setAccountMessage({ type: "error", text: t.passwordMismatch });
      setAccountSubmitting(null);
      return;
    }

    try {
      const response = await fetch(withBasePath("/api/auth/password"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          currentPassword: accountPasswordForm.currentPassword,
          newPassword: accountPasswordForm.newPassword
        })
      });
      const payload = (await response.json()) as { user?: User; error?: string };

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? t.accountUpdateFailed);
      }

      setUser(payload.user);
      setAccountPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: ""
      });
      setAccountMessage({ type: "success", text: t.passwordUpdated });
    } catch (caughtError) {
      setAccountMessage({ type: "error", text: caughtError instanceof Error ? caughtError.message : t.accountUpdateFailed });
    } finally {
      setAccountSubmitting(null);
    }
  }

  async function submitDeleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAccountMessage(null);
    setAccountSubmitting("delete");

    try {
      const response = await fetch(withBasePath("/api/auth/me"), {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ currentPassword: accountDeletePassword })
      });
      const payload = (await response.json()) as { ok?: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? t.accountDeleteFailed);
      }

      router.push("/login");
    } catch (caughtError) {
      setAccountMessage({ type: "error", text: caughtError instanceof Error ? caughtError.message : t.accountDeleteFailed });
      setAccountSubmitting(null);
    }
  }

  async function shareBoard(board: BoardSummary) {
    const url = `${window.location.origin}${withBasePath(`/s/${board.shareId}`)}`;

    try {
      if (navigator.share) {
        await navigator.share({ title: board.title, url });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
    }

    await navigator.clipboard.writeText(url);
    setCopiedId(board.id);
    window.setTimeout(() => setCopiedId(""), 1600);
  }

  if (isLoading) {
    return (
      <main className="board-empty-state">
        <Loader2 className="spin" size={28} />
        {t.loadingBoards}
      </main>
    );
  }

  return (
    <main className="boards-shell">
      <header className="boards-header">
        <div>
          <h1>{t.myBoards}</h1>
          {user ? <p>{user.nickname ? `${user.nickname} · ${user.email}` : user.email}</p> : null}
        </div>
        <div className="boards-actions">
          <LanguageSelect label={t.language} locale={locale} onChange={setLocale} />
          <button className="button secondary" type="button" onClick={openAccountDialog}>
            <UserCircle size={18} />
            {t.account}
          </button>
          <button className="button secondary" type="button" onClick={logout}>
            <LogOut size={18} />
            {t.logout}
          </button>
          <button
            className="button primary"
            disabled={Boolean(user && boards.length >= user.maxBoards)}
            type="button"
            title={user && boards.length >= user.maxBoards ? t.boardLimitReached.replace("{limit}", String(user.maxBoards)) : t.createBoard}
            onClick={openCreateDialog}
          >
            <Plus size={18} />
            {t.createBoard}
          </button>
        </div>
      </header>

      {user ? (
        <p className="boards-limit-hint">
          {t.boardLimitUsage.replace("{count}", String(boards.length)).replace("{limit}", String(user.maxBoards))}
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      <section className="boards-grid">
        {boards.map((board) => (
          <article className="board-list-card" key={board.id}>
            <div>
              <h2>{board.title}</h2>
              <p>{board.itemCount} {t.gamesCount} · {new Date(board.updatedAt).toLocaleDateString()}</p>
            </div>
            <div className="board-list-actions">
              <Link className="button secondary" href={`/board/${board.id}`}>
                {t.openBoard}
              </Link>
              <button className="icon-button" type="button" onClick={() => openRenameDialog(board)} title={t.renameBoard}>
                <Pencil size={17} />
              </button>
              <button className="icon-button" type="button" onClick={() => shareBoard(board)} title={t.shareBoard}>
                <Share2 size={17} />
              </button>
              <button className="icon-button danger" type="button" onClick={() => setDeleteTarget(board)} title={t.deleteBoard}>
                <Trash2 size={17} />
              </button>
            </div>
            {copiedId === board.id ? <span className="copy-hint">{t.shareCopied}</span> : null}
          </article>
        ))}

        {boards.length === 0 ? (
          <div className="boards-empty">
            <h2>{t.noBoards}</h2>
            <button
              className="button primary"
              disabled={Boolean(user && boards.length >= user.maxBoards)}
              type="button"
              onClick={openCreateDialog}
            >
              <Plus size={18} />
              {t.createBoard}
            </button>
          </div>
        ) : null}
      </section>

      {nameDialog ? (
        <div className="dialog-backdrop">
          <section className="board-dialog" role="dialog" aria-modal="true" aria-labelledby="board-name-title">
            <h2 id="board-name-title">{nameDialog.mode === "create" ? t.createBoardDialogTitle : t.renameBoardDialogTitle}</h2>
            <form className="board-dialog-form" onSubmit={submitBoardName}>
              <label>
                <span>{t.boardName}</span>
                <input
                  autoFocus
                  maxLength={20}
                  placeholder={t.boardNamePlaceholder}
                  type="text"
                  value={boardName}
                  onChange={(event) => setBoardName(event.target.value)}
                />
              </label>
              <div className="dialog-actions">
                <button className="button secondary" type="button" onClick={() => setNameDialog(null)}>
                  {t.cancel}
                </button>
                <button className="button primary" disabled={isNameSubmitting} type="submit">
                  {isNameSubmitting ? <Loader2 className="spin" size={18} /> : null}
                  {t.confirm}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="dialog-backdrop">
          <section className="board-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-board-title">
            <h2 id="delete-board-title">{t.confirmDeleteBoard}</h2>
            <p>{deleteTarget.title}</p>
            <p>{t.confirmDeleteBoardDetail}</p>
            <div className="dialog-actions">
              <button className="button secondary" type="button" onClick={() => setDeleteTarget(null)}>
                {t.cancel}
              </button>
              <button className="button danger" type="button" onClick={confirmDeleteBoard}>
                <Trash2 size={18} />
                {t.deleteBoard}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isAccountOpen ? (
        <div className="dialog-backdrop">
          <section className="board-dialog account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-title">
            <div className="account-dialog-header">
              <div>
                <h2 id="account-title">{t.accountManagement}</h2>
                {user ? <p>{user.email}</p> : null}
              </div>
              <button className="icon-button" type="button" onClick={() => setIsAccountOpen(false)} aria-label={t.cancel}>
                ×
              </button>
            </div>

            {accountMessage ? (
              <p className={accountMessage.type === "success" ? "success-text" : "error-text"}>{accountMessage.text}</p>
            ) : null}

            <form className="account-section" onSubmit={submitNickname}>
              <h3>{t.changeNickname}</h3>
              <label>
                <span>{t.nickname}</span>
                <input
                  maxLength={20}
                  type="text"
                  value={accountNickname}
                  onChange={(event) => setAccountNickname(event.target.value)}
                />
              </label>
              <div className="dialog-actions">
                <button className="button secondary" disabled={accountSubmitting === "nickname"} type="submit">
                  {accountSubmitting === "nickname" ? <Loader2 className="spin" size={18} /> : null}
                  {t.saveNickname}
                </button>
              </div>
            </form>

            <form className="account-section" onSubmit={submitPassword}>
              <h3>{t.changePassword}</h3>
              <label>
                <span>{t.currentPassword}</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={accountPasswordForm.currentPassword}
                  onChange={(event) =>
                    setAccountPasswordForm((current) => ({
                      ...current,
                      currentPassword: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                <span>{t.newPassword}</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={accountPasswordForm.newPassword}
                  onChange={(event) =>
                    setAccountPasswordForm((current) => ({
                      ...current,
                      newPassword: event.target.value
                    }))
                  }
                />
              </label>
              <label>
                <span>{t.confirmNewPassword}</span>
                <input
                  autoComplete="new-password"
                  type="password"
                  value={accountPasswordForm.confirmPassword}
                  onChange={(event) =>
                    setAccountPasswordForm((current) => ({
                      ...current,
                      confirmPassword: event.target.value
                    }))
                  }
                />
              </label>
              <div className="dialog-actions">
                <button className="button secondary" disabled={accountSubmitting === "password"} type="submit">
                  {accountSubmitting === "password" ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
                  {t.updatePassword}
                </button>
              </div>
            </form>

            <form className="account-section danger-zone" onSubmit={submitDeleteAccount}>
              <h3>{t.deleteAccount}</h3>
              <p>{t.deleteAccountWarning}</p>
              <label>
                <span>{t.currentPassword}</span>
                <input
                  autoComplete="current-password"
                  type="password"
                  value={accountDeletePassword}
                  onChange={(event) => setAccountDeletePassword(event.target.value)}
                />
              </label>
              <div className="dialog-actions">
                <button className="button danger" disabled={accountSubmitting === "delete"} type="submit">
                  {accountSubmitting === "delete" ? <Loader2 className="spin" size={18} /> : <Trash2 size={18} />}
                  {t.deleteAccountConfirm}
                </button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </main>
  );
}
