"use client";

import {
  BarChart3,
  CheckCircle2,
  Gamepad2,
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

import type {
  AdminGameDetail,
  AdminGameSummary,
  AdminTermTranslation,
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

function formatDate(value: string | undefined) {
  return value ? new Date(value).toLocaleDateString() : "-";
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
        const response = await fetch("/api/admin/me");
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
        <Link className="admin-feature-card" href="/admin/analytics">
          <BarChart3 size={22} />
          <h2>数据分析</h2>
          <p>查看用户、白板、桌游资料和汉化覆盖的汇总趋势。</p>
        </Link>
      </section>
    </AdminFrame>
  );
}

export function AdminUsersClient() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadUsers(nextQuery = query, nextStatus = status) {
    setIsLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ q: nextQuery, status: nextStatus });
      const response = await fetch(`/api/admin/users?${params.toString()}`);
      const payload = (await response.json()) as AdminListResponse<{ users?: AdminUserSummary[]; error?: string }>;

      if (!response.ok) {
        throw new Error(payload.error ?? "加载用户失败");
      }

      setUsers(payload.users ?? []);
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

    const response = await fetch(`/api/admin/users/${user.id}`, {
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

export function AdminGamesClient() {
  const [query, setQuery] = useState("");
  const [games, setGames] = useState<AdminGameSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadGames(nextQuery = query) {
    setIsLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({ q: nextQuery });
      const response = await fetch(`/api/admin/games?${params.toString()}`);
      const payload = (await response.json()) as AdminListResponse<{ games?: AdminGameSummary[]; error?: string }>;

      if (!response.ok) {
        throw new Error(payload.error ?? "加载桌游失败");
      }

      setGames(payload.games ?? []);
      setTotal(payload.total ?? 0);
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
    await loadGames();
  }

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
                  <Link className="button secondary" href={`/admin/games/${game.bggId}`}>
                    编辑
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

export function AdminGameDetailClient({ bggId }: { bggId: string }) {
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
      const response = await fetch(`/api/admin/games/${bggId}`);
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
      const response = await fetch(`/api/admin/games/${bggId}`, {
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
      const response = await fetch(`/api/admin/games/${bggId}/refresh?locale=zh-CN`, { method: "POST" });
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

  if (isLoading) {
    return (
      <AdminFrame title="桌游信息管理">
        <Loader2 className="spin" size={28} />
      </AdminFrame>
    );
  }

  return (
    <AdminFrame title={game?.englishName ?? "桌游详情"} subtitle={`BGG ID ${bggId}`}>
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

export function AdminAnalyticsClient() {
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadAnalytics() {
      try {
        const response = await fetch("/api/admin/analytics");
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

          <section className="admin-table-card">
            <h2>30 天趋势</h2>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>注册用户</th>
                  <th>新建白板</th>
                  <th>更新白板</th>
                </tr>
              </thead>
              <tbody>
                {analytics.trend.map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{row.users}</td>
                    <td>{row.boardsCreated}</td>
                    <td>{row.boardsUpdated}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
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
