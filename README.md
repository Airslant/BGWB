# BGWB

BGWB 是一个网页端桌游展示柜 MVP：用户用邮箱、昵称和密码注册登录，在无限画布上添加 BGG 桌游和扩展封面、备注和收藏状态，并通过公开只读链接分享。

## Data Model

当前使用本地 SQLite：

- `boards`：白板主体和视图状态。
- `board_items`：白板上的卡片位置、缩放、封面比例模式、备注、收藏状态。
- `users`：邮箱账号、昵称、角色、禁用状态和密码哈希。
- `sessions`：HttpOnly cookie 对应的登录会话。
- `email_verification_codes`：注册和找回密码的 6 位邮箱验证码哈希、频控和尝试次数。
- `games`：本地桌游主数据，按 BGG ID 唯一保存。多个白板添加同一款游戏时复用这份数据。
- `game_links`：BGG `thing` 返回的结构化 link 关系，保存 link 类型、BGG link ID、名称、inbound 标记和排序；覆盖设计师、画师、出版社、分类、机制、family、扩展、实现/重制、整合、合集和配件关系。
- `game_localizations`：平台维护的每款游戏本地化正式名称，当前支持 `en` 和 `zh-CN`。
- `game_aliases`：平台维护的每款游戏搜索别名，当前支持 `en` 和 `zh-CN`，只用于召回，不替代正式展示名。
- `game_index`：BGG 全量游戏 CSV 轻索引，只存 ID、名称、排名、均分等搜索字段。
- `bgg_cache`：BGG 搜索和详情请求缓存，用于减少对 BGG 的重复请求。
- `.data/covers`：本地封面缓存目录，按 BGG ID 保存原图和缩略图文件。

BGG 现在是补数据源：搜索优先查 `game_localizations`、`game_aliases`、`games`，再查 `game_index`；详情优先查 `games`。本地没有时才请求 BGG。页面语言支持 `en` / `zh-CN`，展示名优先使用当前语言，缺失时回退英文名或 BGG 原名。

白板默认自动保存：标题、画布视图、卡片位置、缩放、封面比例、备注和收藏状态变更后防抖写入。保存接口只接收白板个人数据，不重复上传 `gameSnapshot`；桌游主数据从本地 `games` 表恢复。

## API Notes

- `POST /api/auth/register/code`：发送注册验证码，邮箱已注册时返回明确错误。
- `POST /api/auth/register`、`POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`：邮箱账号、昵称和会话。
- `POST /api/auth/password-reset/code`、`POST /api/auth/password-reset/confirm`：找回密码验证码和重置确认。
- `GET /api/boards`：当前用户白板列表。
- `POST /api/boards`：当前用户新建白板，可传入最长 20 个字符的 `title`。
- `GET /api/boards/:boardId?locale=`：读取当前用户自己的可编辑白板。
- `PUT /api/boards/:boardId?locale=`：保存 compact payload：`title`、`viewport`、`items[id,bggId,x,y,scale,coverMode,note,status]`。
- `DELETE /api/boards/:boardId`：删除当前用户自己的白板。
- `GET /api/share/:shareId?locale=`：公开只读读取白板。
- `GET /api/bgg/search?q=&locale=`：登录用户本地优先搜索桌游和扩展，结果包含 `displayName`、`canonicalName`、`matchedAlias`、`thingType` 等字段。
- `GET /api/bgg/things/:bggId?locale=`：登录用户读取桌游或扩展详情并应用当前语言的展示名。
- `GET /api/bgg/things/:bggId/naming?locale=`：读取平台维护的英文名、中文名、英文别名、中文别名。公开 `PUT` 当前返回 403。
- `GET /api/covers/:bggId/:kind`：读取本地缓存封面，`kind` 为 `image` 或 `thumbnail`。
- `/admin`：管理后台入口。管理员由 `ADMIN_EMAILS` 指定，后台包含用户管理、桌游信息维护、汉化导入导出和数据分析。
- `GET /api/admin/me`、`GET /api/admin/users`、`PATCH /api/admin/users/:userId`：管理员身份和用户启用/禁用。
- `GET /api/admin/games`、`GET/PUT /api/admin/games/:bggId`、`POST /api/admin/games/:bggId/refresh`：桌游维护字段和 BGG 详情刷新。
- `GET /api/admin/translations/export`：导出当前新增待翻译内容为 Markdown 下载。
- `POST /api/admin/translations/import`：上传翻译后的 Markdown，并将非空翻译结果写入本地化表。
- `GET /api/admin/analytics`：基于现有表的用户、白板、桌游和汉化覆盖分析。

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 3000
```

打开 `http://127.0.0.1:3000`。

首次打开新版账号系统时，会清空旧 8 位口令白板数据；本地桌游详情、BGG 轻索引、封面缓存和中文翻译会保留。

## Environment

- `BGG_API_TOKEN`：BoardGameGeek XML API 的服务端 token。没有 token 时，BGG 搜索/详情接口会返回错误。
- `BGWB_DB_PATH`：SQLite 数据库路径，默认 `.data/bgwb.sqlite`。
- `BGG_REQUEST_INTERVAL_MS`：真实 BGG XML 请求之间的最小间隔，默认 `5200`。
- `BGG_INDEX_CSV_PATH`：BGG 全量轻索引 CSV 的本地保存路径，默认 `.data/bgg/bg_ranks.csv`。
- `BGWB_COVER_CACHE_PATH`：本地封面缓存目录，默认 `.data/covers`。
- `ADMIN_EMAILS`：管理员邮箱白名单，逗号分隔；匹配邮箱注册或登录时会自动授予 `admin` 角色。
- `EMAIL_DELIVERY_MODE`：邮件发送模式，`console` 为本地日志输出验证码，`aliyun` 为调用阿里云 DirectMail；未配置时开发环境默认 `console`、生产默认 `aliyun`。
- `EMAIL_CODE_SECRET`：验证码哈希密钥。生产环境必须配置一段高强度随机字符串。
- `ALIYUN_ACCESS_KEY_ID` / `ALIYUN_ACCESS_KEY_SECRET`：阿里云 RAM 访问密钥，需有 `dm:SingleSendMail` 权限。
- `ALIYUN_DM_ACCOUNT_NAME`：阿里云邮件推送中的发信地址，默认 `noreply@boardgamewb.com`。
- `ALIYUN_DM_FROM_ALIAS`：发信人昵称，默认 `BGWB`。
- `ALIYUN_DM_ENDPOINT`：阿里云 DirectMail endpoint，默认 `dm.aliyuncs.com`。

## Email Setup

第一版交易邮件使用阿里云 DirectMail / 邮件推送。上线前需要在阿里云控制台完成：

1. 添加并验证发信域名 `boardgamewb.com`。
2. 按控制台生成值配置 SPF、DKIM、DMARC、MX 等 DNS 记录。
3. 创建发信地址 `noreply@boardgamewb.com`。
4. 创建 RAM AccessKey，并授予调用 `SingleSendMail` 的最小权限。
5. 生产环境设置 `EMAIL_DELIVERY_MODE=aliyun` 和 `EMAIL_CODE_SECRET`。

本地开发推荐保留 `EMAIL_DELIVERY_MODE=console`，验证码会打印在服务端日志里，不会调用阿里云。

## Commands

```bash
npm run typecheck
npm run build
npm run bgg:import-index
npm run bgg:import-index -- --use-existing
npm run bgg:export-translations
npm run bgg:import-translations -- translations/bgg-translation-2026-05-27.md
```

`npm run bgg:import-index` 会下载 BGG 官方 `bg_ranks` CSV 并导入 `game_index`。如果已经手动下载到 `.data/bgg/bg_ranks.csv`，使用 `npm run bgg:import-index -- --use-existing` 直接导入本地文件。CSV 只作为本地搜索索引；机制、设计师、人数等完整详情仍由 `/xmlapi2/thing` 按用户实际选择按需补齐桌游或扩展，并长期写入 `games` 和 `game_links`。封面首次获取详情时会下载到 `.data/covers`，前端优先读取本地封面，失败时回退 BGG 原始图片 URL。

后台 `/admin/translations` 可直接下载新增待翻译 Markdown，并上传翻译后的 Markdown 回填。CLI 翻译命令保留用于本地维护或批处理。

## Product Source

后续产品事实源维护在 [PRD.md](/Users/airslant/Documents/BGWB/PRD.md)。
