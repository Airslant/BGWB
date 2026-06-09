"use client";

import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  FileDown,
  FileUp,
  Gamepad2,
  Languages,
  Loader2,
  RefreshCcw,
  Search,
  Shield,
  Users,
  XCircle
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";

import { withBasePath } from "@/lib/base-path";
import type {
  AdminGameDetail,
  AdminGameSummary,
  AdminTermTranslation,
  AdminTranslationImportResult,
  AdminUser,
  AdminUserSummary
} from "@/lib/types";

type AdminListResponse<T> = {
  total: number;
  page: number;
  pageSize: number;
} & T;

type AnalyticsResponse = {
  metrics: Record<string, number>;
  recentUsers: AdminUser[];
  recentBoards: Array<{ id: string; title: string; ownerEmail: string; updatedAt: string }>;
  popularGames: Array<{ bggId: string; englishName: string; zhName: string; yearPublished?: number; itemCount: number }>;
  missingZhNames: Array<{ bggId: string; englishName: string; itemCount: number }>;
  missingZhDescriptions: Array<{ bggId: string; englishName: string; itemCount: number }>;
  trend: Array<{ date: string; users: number; boardsCreated: number; boardsUpdated: number }>;
};
type AnalyticsTrendRow = AnalyticsResponse["trend"][number];

function formatDate(value: string | undefined) {
  return value ? new Date(value).toLocaleDateString() : "-";
}

function buildAdminGamesPath(query: string, page: number) {
  const params = new URLSearchParams();
  const trimmedQuery = query.trim();

  if (trimmedQuery) {
    params.set("q", trimmedQuery);
  }

  if (page > 1) {
    params.set("page", String(page));
  }

  const queryString = params.toString();
  return `/admin/games${queryString ? `?${queryString}` : ""}`;
}

function getSafeAdminGamesReturnPath(value: string | null) {
  if (!value) {
    return "/admin/games";
  }

  return value === "/admin/games" || value.startsWith("/admin/games?") ? value : "/admin/games";
}

function joinAliases(value: string[] | undefined) {
  return (value ?? []).join("\n");
}

function splitAliases(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((alias) => alias.trim())
    .filter(Boolean)
    .slice(0, 24);
}

function AdminFrame({ children, subtitle, title }: { children: ReactNode; subtitle?: string; title: string }) {
  const router = useRouter();
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAdmin() {
      try {
        const response = await fetch(withBasePath("/api/admin/me"));
        const payload = (await response.json()) as { admin?: AdminUser; error?: string };

        if (!response.ok || !payload.admin) {
          router.replace("/login");
          return;
        }

        if (!cancelled) {
          setAdmin(payload.admin);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : "后台加载失败");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadAdmin();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (isLoading) {
    return (
      <main className="board-empty-state">
        <Loader2 className="spin" size={28} />
        正在打开后台
      </main>
    );
  }

  if (error) {
    return (
      <main className="board-empty-state">
        <h1>后台不可用</h1>
        <p>{error}</p>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link className="admin-brand" href="/admin">
          <Shield size={20} />
          BGWB Admin
        </Link>
        <nav>
          <Link href="/admin/users">
            <Users size={17} />
            用户管理
          </Link>
          <Link href="/admin/games">
            <Gamepad2 size={17} />
            桌游信息
          </Link>
          <Link href="/admin/translations">
            <Languages size={17} />
            汉化导入导出
          </Link>
          <Link href="/admin/analytics">
            <BarChart3 size={17} />
            数据分析
          </Link>
        </nav>
        <div className="admin-account">
          <strong>{admin?.nickname || admin?.email}</strong>
          <span>{admin?.email}</span>
        </div>
      </aside>
      <section className="admin-main">
        <header className="admin-page-header">
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <Link className="button secondary" href="/boards">
            回到白板
          </Link>
        </header>
        {children}
      </section>
    </main>
  );
}

export function AdminHomeClient() {
  return (
    <AdminFrame title="管理后台" subtitle="管理用户、桌游维护数据和基础运营指标。">
      <section className="admin-card-grid">
        <Link className="admin-feature-card" href="/admin/users">
          <Users size={22} />
          <h2>用户管理</h2>
          <p>检索注册用户，查看白板使用量，禁用或启用账号。</p>
        </Link>
        <Link className="admin-feature-card" href="/admin/games">
          <Gamepad2 size={22} />
          <h2>桌游信息管理</h2>
          <p>维护中英文名、别名、中文简介和术语翻译。</p>
        </Link>
        <Link className="admin-feature-card" href="/admin/translations">
          <Languages size={22} />
          <h2>汉化导入导出</h2>
          <p>导出新增待翻译内容，上传翻译后的 Markdown 自动回填。</p>
        </Link>
        <Link className="admin-feature-card" href="/admin/analytics">
          <BarChart3 size={22} />
          <h2>数据分析</h2>
          <p>查看用户、白板、桌游资料和汉化覆盖的汇总趋势。</p>
        </Link>
      </section>
    </AdminFrame>
  );
}

export function AdminTranslationsClient() {
  const [file, setFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<AdminTranslationImportResult | null>(null);

  async function importTranslations(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("请先选择一个 Markdown 文件。");
      return;
    }

    setIsImporting(true);
    setError("");
    setNotice("");
    setResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(withBasePath("/api/admin/translations/import"), {
        method: "POST",
        body: formData
      });
      const payload = (await response.json()) as { result?: AdminTranslationImportResult; error?: string };

      if (!response.ok || !payload.result) {
        throw new Error(payload.error ?? "导入失败");
      }

      setResult(payload.result);
      setNotice("翻译内容已导入");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "导入失败");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <AdminFrame title="汉化导入导出" subtitle="按 BGWB Markdown 表格格式维护新增待翻译内容。">
      <section className="admin-card-grid">
        <div className="admin-feature-card">
          <FileDown size={22} />
          <h2>导出待翻译内容</h2>
          <p>下载当前库内尚未维护中文名、中文简介、分类和机制翻译的新增内容。</p>
          <a className="button primary" href={withBasePath("/api/admin/translations/export")} download>
            <FileDown size={17} />
            下载 Markdown
          </a>
        </div>
        <form className="admin-feature-card" onSubmit={importTranslations}>
          <FileUp size={22} />
          <h2>导入已翻译内容</h2>
          <p>上传翻译后的 Markdown，系统会把非空翻译结果写入本地桌游数据库。</p>
          <input
            accept=".md,text/markdown,text/plain"
            type="file"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <button className="button primary" disabled={isImporting} type="submit">
            {isImporting ? <Loader2 className="spin" size={17} /> : <FileUp size={17} />}
            导入 Markdown
          </button>
        </form>
      </section>
      {error ? <p className="error-text">{error}</p> : null}
      {notice ? <p className="success-text">{notice}</p> : null}
      {result ? (
        <section className="admin-metric-grid">
          <MetricCard label="中文名" value={result.names} />
          <MetricCard label="分类术语" value={result.categories} />
          <MetricCard label="机制术语" value={result.mechanics} />
          <MetricCard label="中文简介" value={result.descriptions} />
        </section>
      ) : null}
    </AdminFrame>
  );
}

export function AdminUsersClient() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [limitDrafts, setLimitDrafts] = useState<Record<string, string>>({});
  const [updatingLimitId, setUpdatingLimitId] = useState("");
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadUsers(nextQuery = query, nextStatus = status) {
    setIsLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ q: nextQuery, status: nextStatus });
      const response = await fetch(withBasePath(`/api/admin/users?${params.toString()}`));
      const payload = (await response.json()) as AdminListResponse<{ users?: AdminUserSummary[]; error?: string }>;

      if (!response.ok) {
        throw new Error(payload.error ?? "加载用户失败");
      }

      const nextUsers = payload.users ?? [];
      setUsers(nextUsers);
      setLimitDrafts(Object.fromEntries(nextUsers.map((user) => [user.id, String(user.maxBoards)])));
      setTotal(payload.total ?? 0);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "加载用户失败");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadUsers();
  }

  async function toggleUser(user: AdminUserSummary) {
    const disabled = !user.disabledAt;
    const promptedReason = disabled ? window.prompt("禁用原因（可选）", user.disabledReason ?? "") : "";

    if (disabled && promptedReason === null) {
      return;
    }

    const reason = promptedReason ?? "";

    const response = await fetch(withBasePath(`/api/admin/users/${user.id}`), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ disabled, reason })
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error ?? "更新用户失败");
      return;
    }

    await loadUsers();
  }

  async function updateBoardLimit(user: AdminUserSummary) {
    const maxBoards = Number(limitDrafts[user.id]);

    if (!Number.isInteger(maxBoards) || maxBoards < 0 || maxBoards > 500) {
      setError("白板上限需要是 0-500 之间的整数");
      return;
    }

    setUpdatingLimitId(user.id);
    setError("");

    const response = await fetch(withBasePath(`/api/admin/users/${user.id}`), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ maxBoards })
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setError(payload.error ?? "更新白板上限失败");
      setUpdatingLimitId("");
      return;
    }

    await loadUsers();
    setUpdatingLimitId("");
  }

  return (
    <AdminFrame title="用户管理" subtitle={`共 ${total} 个用户`}>
      <form className="admin-filter-bar" onSubmit={submitSearch}>
        <label>
          <span>检索</span>
          <input placeholder="邮箱或昵称" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label>
          <span>状态</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">全部</option>
            <option value="active">正常</option>
            <option value="disabled">已禁用</option>
          </select>
        </label>
        <button className="button primary" type="submit">
          <Search size={17} />
          搜索
        </button>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="admin-table-card">
        {isLoading ? <Loader2 className="spin" size={22} /> : null}
        <table className="admin-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>角色</th>
              <th>状态</th>
              <th>白板</th>
              <th>白板上限</th>
              <th>卡片</th>
              <th>注册</th>
              <th>更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.nickname || "-"}</strong>
                  <span>{user.email}</span>
                </td>
                <td>{user.role === "admin" ? "管理员" : "用户"}</td>
                <td>{user.disabledAt ? "已禁用" : "正常"}</td>
                <td>{user.boardCount}</td>
                <td>
                  <div className="admin-inline-control">
                    <input
                      aria-label={`${user.email} 白板上限`}
                      min={0}
                      max={500}
                      type="number"
                      value={limitDrafts[user.id] ?? String(user.maxBoards)}
                      onChange={(event) =>
                        setLimitDrafts((current) => ({
                          ...current,
                          [user.id]: event.target.value
                        }))
                      }
                    />
                    <button
                      className="button secondary"
                      disabled={updatingLimitId === user.id || limitDrafts[user.id] === String(user.maxBoards)}
                      type="button"
                      onClick={() => updateBoardLimit(user)}
                    >
                      {updatingLimitId === user.id ? <Loader2 className="spin" size={16} /> : <CheckCircle2 size={16} />}
                      保存
                    </button>
                  </div>
                </td>
                <td>{user.itemCount}</td>
                <td>{formatDate(user.createdAt)}</td>
                <td>{formatDate(user.updatedAt)}</td>
                <td>
                  <button
                    className={`button ${user.disabledAt ? "secondary" : "danger"}`}
                    disabled={user.role === "admin" && !user.disabledAt}
                    type="button"
                    onClick={() => toggleUser(user)}
                  >
                    {user.disabledAt ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                    {user.disabledAt ? "启用" : "禁用"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminFrame>
  );
}

export function AdminGamesClient({ initialPage = 1, initialQuery = "" }: { initialPage?: number; initialQuery?: string }) {
  const router = useRouter();
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [games, setGames] = useState<AdminGameSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(20);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadGames(nextQuery = query, nextPage = page) {
    setIsLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ q: nextQuery, page: String(nextPage) });
      const response = await fetch(withBasePath(`/api/admin/games?${params.toString()}`));
      const payload = (await response.json()) as AdminListResponse<{ games?: AdminGameSummary[]; error?: string }>;

      if (!response.ok) {
        throw new Error(payload.error ?? "加载桌游失败");
      }

      const resolvedPage = payload.page ?? nextPage;
      setGames(payload.games ?? []);
      setTotal(payload.total ?? 0);
      setPage(resolvedPage);
      setActiveQuery(nextQuery);
      setPageSize(payload.pageSize ?? 20);
      router.replace(buildAdminGamesPath(nextQuery, resolvedPage), { scroll: false });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "加载桌游失败");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadGames(query, 1);
  }

  async function goToPage(nextPage: number) {
    await loadGames(query, nextPage);
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const pageEnd = Math.min(total, page * pageSize);
  const currentListPath = buildAdminGamesPath(activeQuery, page);

  return (
    <AdminFrame title="桌游信息管理" subtitle={`本地详情库共 ${total} 款桌游`}>
      <form className="admin-filter-bar" onSubmit={submitSearch}>
        <label>
          <span>检索</span>
          <input placeholder="BGG ID、英文名、中文名或别名" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <button className="button primary" type="submit">
          <Search size={17} />
          搜索
        </button>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
      <div className="admin-table-card">
        {isLoading ? <Loader2 className="spin" size={22} /> : null}
        <table className="admin-table">
          <thead>
            <tr>
              <th>BGG ID</th>
              <th>英文名</th>
              <th>中文名</th>
              <th>年份</th>
              <th>使用次数</th>
              <th>更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {games.map((game) => (
              <tr key={game.bggId}>
                <td>{game.bggId}</td>
                <td>
                  <strong>{game.englishName}</strong>
                </td>
                <td>{game.zhName || "-"}</td>
                <td>{game.yearPublished ?? "-"}</td>
                <td>{game.itemCount}</td>
                <td>{formatDate(game.updatedAt)}</td>
                <td>
                  <Link className="button secondary" href={`/admin/games/${game.bggId}?returnTo=${encodeURIComponent(currentListPath)}`}>
                    编辑
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-pagination">
        <span>
          第 {page} / {totalPages} 页 · 显示 {pageStart}-{pageEnd} / {total}
        </span>
        <div>
          <button className="button secondary" disabled={isLoading || page <= 1} type="button" onClick={() => goToPage(page - 1)}>
            上一页
          </button>
          <button className="button secondary" disabled={isLoading || page >= totalPages} type="button" onClick={() => goToPage(page + 1)}>
            下一页
          </button>
        </div>
      </div>
    </AdminFrame>
  );
}

function TermEditor({
  rows,
  setRows,
  title
}: {
  rows: AdminTermTranslation[];
  setRows: (rows: AdminTermTranslation[]) => void;
  title: string;
}) {
  return (
    <section className="admin-edit-section">
      <h2>{title}</h2>
      <div className="term-grid">
        {rows.map((row, index) => (
          <label key={row.term}>
            <span>{row.term}</span>
            <input
              value={row.translation}
              onChange={(event) =>
                setRows(rows.map((currentRow, currentIndex) => (currentIndex === index ? { ...currentRow, translation: event.target.value } : currentRow)))
              }
            />
          </label>
        ))}
      </div>
    </section>
  );
}

export function AdminGameDetailClient({ bggId, returnTo }: { bggId: string; returnTo?: string }) {
  const [game, setGame] = useState<AdminGameDetail | null>(null);
  const [englishName, setEnglishName] = useState("");
  const [zhName, setZhName] = useState("");
  const [englishAliases, setEnglishAliases] = useState("");
  const [zhAliases, setZhAliases] = useState("");
  const [zhDescription, setZhDescription] = useState("");
  const [categoryTranslations, setCategoryTranslations] = useState<AdminTermTranslation[]>([]);
  const [mechanicTranslations, setMechanicTranslations] = useState<AdminTermTranslation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function applyGame(nextGame: AdminGameDetail) {
    setGame(nextGame);
    setEnglishName(nextGame.localizedNames.en || nextGame.englishName);
    setZhName(nextGame.localizedNames["zh-CN"] || "");
    setEnglishAliases(joinAliases(nextGame.aliases.en));
    setZhAliases(joinAliases(nextGame.aliases["zh-CN"]));
    setZhDescription(nextGame.zhDescription || "");
    setCategoryTranslations(nextGame.categoryTranslations);
    setMechanicTranslations(nextGame.mechanicTranslations);
  }

  async function loadGame() {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch(withBasePath(`/api/admin/games/${bggId}`));
      const payload = (await response.json()) as { game?: AdminGameDetail; error?: string };

      if (!response.ok || !payload.game) {
        throw new Error(payload.error ?? "加载桌游失败");
      }

      applyGame(payload.game);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "加载桌游失败");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bggId]);

  async function saveGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(withBasePath(`/api/admin/games/${bggId}`), {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          localizedNames: {
            en: englishName,
            "zh-CN": zhName
          },
          aliases: {
            en: splitAliases(englishAliases),
            "zh-CN": splitAliases(zhAliases)
          },
          zhDescription,
          categoryTranslations,
          mechanicTranslations
        })
      });
      const payload = (await response.json()) as { game?: AdminGameDetail; error?: string };

      if (!response.ok || !payload.game) {
        throw new Error(payload.error ?? "保存失败");
      }

      applyGame(payload.game);
      setNotice("已保存");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "保存失败");
    } finally {
      setIsSaving(false);
    }
  }

  async function refreshGame() {
    setIsRefreshing(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(withBasePath(`/api/admin/games/${bggId}/refresh?locale=zh-CN`), { method: "POST" });
      const payload = (await response.json()) as { game?: AdminGameDetail; error?: string };

      if (!response.ok || !payload.game) {
        throw new Error(payload.error ?? "刷新失败");
      }

      applyGame(payload.game);
      setNotice("BGG 详情已刷新");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "刷新失败");
    } finally {
      setIsRefreshing(false);
    }
  }

  const stats = useMemo(() => {
    if (!game) {
      return [];
    }

    return [
      ["年份", game.snapshot.yearPublished ?? "-"],
      ["人数", game.snapshot.minPlayers && game.snapshot.maxPlayers ? `${game.snapshot.minPlayers}-${game.snapshot.maxPlayers}` : "-"],
      ["时长", game.snapshot.playingTime ? `${game.snapshot.playingTime} 分钟` : "-"],
      ["年龄", game.snapshot.minAge ? `${game.snapshot.minAge}+` : "-"],
      ["评分", game.snapshot.averageRating ? game.snapshot.averageRating.toFixed(1) : "-"],
      ["被使用", game.itemCount]
    ];
  }, [game]);
  const safeReturnTo = getSafeAdminGamesReturnPath(returnTo ?? null);

  if (isLoading) {
    return (
      <AdminFrame title="桌游信息管理">
        <Loader2 className="spin" size={28} />
      </AdminFrame>
    );
  }

  return (
    <AdminFrame title={game?.englishName ?? "桌游详情"} subtitle={`BGG ID ${bggId}`}>
      <div className="admin-page-actions">
        <Link className="button secondary" href={safeReturnTo}>
          <ArrowLeft size={17} />
          返回列表
        </Link>
      </div>
      {error ? <p className="error-text">{error}</p> : null}
      {notice ? <p className="success-text">{notice}</p> : null}
      {game ? (
        <form className="admin-game-detail" onSubmit={saveGame}>
          <section className="admin-detail-hero">
            <div className="admin-cover-preview">
              {game.snapshot.localImage || game.snapshot.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt={game.englishName} src={game.snapshot.localImage || game.snapshot.image} />
              ) : (
                <span>无封面</span>
              )}
            </div>
            <div>
              <div className="admin-stat-grid">
                {stats.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
              <p className="admin-readonly-text">{game.snapshot.description || "暂无英文简介。"}</p>
              <p className="admin-readonly-text">设计师：{game.snapshot.designers.join(", ") || "-"}</p>
              <p className="admin-readonly-text">英文分类：{game.snapshot.categories.join(", ") || "-"}</p>
              <p className="admin-readonly-text">英文机制：{game.snapshot.mechanics.join(", ") || "-"}</p>
              <button className="button secondary" disabled={isRefreshing} type="button" onClick={refreshGame}>
                {isRefreshing ? <Loader2 className="spin" size={17} /> : <RefreshCcw size={17} />}
                从 BGG 刷新详情
              </button>
            </div>
          </section>

          <section className="admin-edit-section">
            <h2>名称与别名</h2>
            <div className="admin-form-grid">
              <label>
                <span>英文名</span>
                <input value={englishName} onChange={(event) => setEnglishName(event.target.value)} />
              </label>
              <label>
                <span>中文名</span>
                <input value={zhName} onChange={(event) => setZhName(event.target.value)} />
              </label>
              <label>
                <span>英文别名（每行一个）</span>
                <textarea value={englishAliases} onChange={(event) => setEnglishAliases(event.target.value)} />
              </label>
              <label>
                <span>中文别名（每行一个）</span>
                <textarea value={zhAliases} onChange={(event) => setZhAliases(event.target.value)} />
              </label>
            </div>
          </section>

          <section className="admin-edit-section">
            <h2>中文简介</h2>
            <textarea className="admin-wide-textarea" value={zhDescription} onChange={(event) => setZhDescription(event.target.value)} />
          </section>

          <TermEditor rows={categoryTranslations} setRows={setCategoryTranslations} title="分类中文翻译" />
          <TermEditor rows={mechanicTranslations} setRows={setMechanicTranslations} title="机制中文翻译" />

          <div className="admin-sticky-actions">
            <button className="button primary" disabled={isSaving} type="submit">
              {isSaving ? <Loader2 className="spin" size={17} /> : null}
              保存维护信息
            </button>
          </div>
        </form>
      ) : null}
    </AdminFrame>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="admin-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatTrendDate(value: string) {
  const [, month, day] = value.split("-");

  return month && day ? `${Number(month)}/${Number(day)}` : value;
}

function buildTrendLinePath(points: Array<{ x: number; y: number }>) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(" ");
}

function AdminTrendChart({ trend }: { trend: AnalyticsTrendRow[] }) {
  const width = 920;
  const height = 320;
  const padding = { bottom: 42, left: 46, right: 24, top: 28 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...trend.flatMap((row) => [row.users, row.boardsCreated, row.boardsUpdated]));
  const xForIndex = (index: number) => padding.left + (trend.length <= 1 ? plotWidth / 2 : (index / (trend.length - 1)) * plotWidth);
  const yForValue = (value: number) => padding.top + plotHeight - (value / maxValue) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => ({
    index,
    value: Math.round((maxValue * (4 - index)) / 4)
  }));
  const dateTicks = trend
    .map((row, index) => ({ index, row }))
    .filter(({ index }) => index === 0 || index === trend.length - 1 || index % 7 === 0);
  const series = [
    { color: "#23466d", key: "users", label: "注册用户" },
    { color: "#3f6f5a", key: "boardsCreated", label: "新建白板" },
    { color: "#c48222", key: "boardsUpdated", label: "更新白板" }
  ] as const;

  return (
    <section className="admin-trend-card">
      <div className="admin-trend-header">
        <div>
          <h2>30 天趋势</h2>
          <p>按天统计注册用户、新建白板和更新白板。</p>
        </div>
        <div className="admin-trend-legend">
          {series.map((item) => (
            <span key={item.key}>
              <i style={{ backgroundColor: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      <div className="admin-trend-chart-scroll">
        <svg aria-label="30 天趋势图" className="admin-trend-chart" role="img" viewBox={`0 0 ${width} ${height}`}>
          {yTicks.map(({ index, value }) => {
            const y = yForValue(value);

            return (
              <g key={`y-${index}`}>
                <line className="admin-trend-grid-line" x1={padding.left} x2={width - padding.right} y1={y} y2={y} />
                <text className="admin-trend-axis-label" x={padding.left - 12} y={y + 4}>
                  {value}
                </text>
              </g>
            );
          })}
          {dateTicks.map(({ index, row }) => {
            const x = xForIndex(index);

            return (
              <text className="admin-trend-axis-label admin-trend-date-label" key={row.date} x={x} y={height - 12}>
                {formatTrendDate(row.date)}
              </text>
            );
          })}
          {series.map((item) => {
            const points = trend.map((row, index) => ({
              x: xForIndex(index),
              y: yForValue(row[item.key]),
              row
            }));

            return (
              <g key={item.key}>
                <path className="admin-trend-line" d={buildTrendLinePath(points)} stroke={item.color} />
                {points.map((point) => (
                  <circle className="admin-trend-point" cx={point.x} cy={point.y} fill={item.color} key={`${item.key}-${point.row.date}`} r={3.5}>
                    <title>{`${point.row.date} · ${item.label}: ${point.row[item.key]}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

export function AdminAnalyticsClient() {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      try {
        const response = await fetch(withBasePath("/api/admin/analytics"));
        const payload = (await response.json()) as AnalyticsResponse & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? "加载分析失败");
        }

        if (!cancelled) {
          setAnalytics(payload);
        }
      } catch (caughtError) {
        if (!cancelled) {
          setError(caughtError instanceof Error ? caughtError.message : "加载分析失败");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadAnalytics();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminFrame title="数据分析" subtitle="基于现有业务表的 30 天汇总。">
      {isLoading ? <Loader2 className="spin" size={28} /> : null}
      {error ? <p className="error-text">{error}</p> : null}
      {analytics ? (
        <>
          <section className="admin-metric-grid">
            <MetricCard label="总用户" value={analytics.metrics.totalUsers} />
            <MetricCard label="活跃用户" value={analytics.metrics.activeUsers} />
            <MetricCard label="禁用用户" value={analytics.metrics.disabledUsers} />
            <MetricCard label="白板" value={analytics.metrics.totalBoards} />
            <MetricCard label="分享链接" value={analytics.metrics.publicShares} />
            <MetricCard label="卡片" value={analytics.metrics.totalBoardItems} />
            <MetricCard label="本地桌游" value={analytics.metrics.totalGames} />
            <MetricCard label="中文名覆盖" value={analytics.metrics.zhNameCoverage} />
            <MetricCard label="中文简介覆盖" value={analytics.metrics.zhDescriptionCoverage} />
            <MetricCard label="分类翻译" value={analytics.metrics.categoryTranslationCoverage} />
            <MetricCard label="机制翻译" value={analytics.metrics.mechanicTranslationCoverage} />
          </section>

          <section className="admin-analytics-grid">
            <AdminList title="热门桌游">
              {analytics.popularGames.map((game) => (
                <li key={game.bggId}>
                  <Link href={`/admin/games/${game.bggId}`}>{game.zhName || game.englishName}</Link>
                  <span>{game.itemCount} 次</span>
                </li>
              ))}
            </AdminList>
            <AdminList title="缺中文名但被使用">
              {analytics.missingZhNames.map((game) => (
                <li key={game.bggId}>
                  <Link href={`/admin/games/${game.bggId}`}>{game.englishName}</Link>
                  <span>{game.itemCount} 次</span>
                </li>
              ))}
            </AdminList>
            <AdminList title="缺中文简介但被使用">
              {analytics.missingZhDescriptions.map((game) => (
                <li key={game.bggId}>
                  <Link href={`/admin/games/${game.bggId}`}>{game.englishName}</Link>
                  <span>{game.itemCount} 次</span>
                </li>
              ))}
            </AdminList>
            <AdminList title="最近注册用户">
              {analytics.recentUsers.map((user) => (
                <li key={user.id}>
                  <span>{user.nickname || user.email}</span>
                  <span>{formatDate(user.createdAt)}</span>
                </li>
              ))}
            </AdminList>
          </section>

          <AdminTrendChart trend={analytics.trend} />
        </>
      ) : null}
    </AdminFrame>
  );
}

function AdminList({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="admin-list-card">
      <h2>{title}</h2>
      <ul>{children}</ul>
    </section>
  );
}
