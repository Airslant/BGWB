# BGWB 桌游白板 PRD v0.1

## Summary

BGWB 是一个网页端「桌游展示柜」：用户通过邮箱和密码注册登录，在无限画布上添加桌游封面，形成可分享的个人收藏墙。账号拥有者可编辑自己的白板，分享链接为公开只读。

第一版视觉方向为「高级收藏墙」：封面是主角，信息轻量悬浮显示，支持备注和收藏状态，但不做复杂社交、权限、多人协作或 BGG 用户收藏导入。

BGG 数据接入按官方 XML API 约束设计：服务端请求 BGG、携带 Authorization Token、缓存结果、控制频率，并在公开页面显示链接回 BoardGameGeek 的官方 Powered by BGG logo。

参考：

- [Using the XML API](https://boardgamegeek.com/using_the_xml_api)
- [BGG XML API2](https://boardgamegeek.com/wiki/page/BGG_XML_API2)

## Key Changes

- 新建本地 PRD 源文档：`/Users/airslant/Documents/BGWB/PRD.md`，后续以该文件为产品事实源，用户直接编辑后，开发按文档差异调整。
- 账号系统：
  - 第一版支持邮箱 + 昵称 + 密码注册登录。
  - 注册必须先发送并输入邮箱验证码，验证通过后才创建账号并写入登录会话。
  - 支持找回密码：邮箱收到 6 位验证码后可设置新密码，重置成功后旧会话全部失效并为当前浏览器创建新会话。
  - 密码服务端哈希保存，登录使用 HttpOnly cookie 会话。
  - 管理员使用 `users.role` 权限模型，`ADMIN_EMAILS` 作为管理员邮箱种子。
  - 用户被禁用后不能登录或编辑，现有会话失效；公开分享页仍可只读访问。
  - 第一版不做邮箱链接登录、改邮箱、团队权限、多人协作或 BGG 账号绑定。
  - 旧 8 位口令白板数据在迁移时清空；桌游主数据、封面缓存、BGG 索引和翻译数据保留。
- MVP 页面：
  - 首页/入口：未登录时引导登录/注册，已登录时进入我的白板列表。
  - 我的白板列表：新建、打开、重命名、删除白板，分享公开只读链接；新建白板前先输入白板名称，名称限制 20 个字符；删除白板需二次确认。
  - 白板页：无限画布、拖拽平移、触摸板 pinch 缩放、快捷键缩放、添加桌游、移动桌游卡片、整理工具、右上角分享、自动保存。
  - 分享页：公开只读展示白板，保留浏览、平移、缩放和整理工具对象展示，不提供编辑、添加或保存。
  - 添加桌游：点击添加后弹出搜索框，调用 BGG 搜索，展示结果列表，用户选择后拉取封面与基础信息。
  - 管理后台：`/admin` 提供用户管理、桌游信息管理和数据分析。
- 桌游卡片：默认显示封面；hover 显示基础信息、备注、收藏状态；支持编辑备注和状态；支持右键菜单；hover 信息顶部提供跳转该游戏 BoardGameGeek 页面入口。
- 白板整理工具：
  - 左侧浮动工具栏提供：选择、添加桌游、文字、便签、分区、矩形、直线、箭头。
  - 工具对象属于白板公开内容，公开分享页只读可见。
  - 文字、便签、分区支持双击编辑文本；矩形、便签、分区、文字支持移动和角点缩放；直线和箭头支持移动整体和拖动端点。
  - 支持 `Shift + 点击` 多选；拖动整理对象时提供类似 Figma 的磁吸对齐参考线。
  - 第一版只提供轻量样式：固定颜色、线宽、字号；便签、分区、矩形支持填充开关，文字、直线、箭头不显示填充；不做图层面板、自由手绘、复杂路径、撤销重做。
- 首页、白板页底部和添加桌游弹窗都展示官方 Powered by BGG logo。
- 卡片封面比例：
  - 默认使用封面图原生比例。
  - 右键菜单可切换为统一比例。
  - 统一比例使用 A4 纸比例 `1:1.414`。
  - 统一比例下封面不裁切，使用完整缩放适配。
- 多语言基础：
  - 第一版支持 `en` 和 `zh-CN`。
  - 首页和白板页支持语言切换，选择保存在浏览器本地。
  - 游戏展示名优先使用当前语言名称；缺失时回退英文名 / BGG 原名。
- 桌游命名维护：
  - 本地数据库维护每款游戏的英文名、中文名、英文别名、中文别名。
  - 名称和别名属于平台/官方维护数据，不属于用户白板的个人可编辑数据。
  - 别名只用于搜索召回和结果辅助提示，不作为默认展示名。
  - MVP 不在卡片 hover 面板里提供名称/别名编辑入口；维护入口在管理后台。
- 管理后台：
  - 用户管理支持按邮箱/昵称检索，展示角色、状态、注册时间、白板数、卡片数；支持禁用/启用普通用户。
  - 桌游信息管理支持按 BGG ID、英文名、中文名、别名搜索；BGG 原始字段只读；可编辑中英文名、别名、中文简介、分类/机制中文翻译。
  - 数据分析基于现有表统计用户、白板、卡片、本地桌游、中文覆盖和最近 30 天趋势；第一版不新增事件埋点。
- 用户个人数据：
  - 当前白板内可编辑的是卡片收藏状态和备注。
  - 收藏状态和备注跟随用户白板保存，不回写桌游主数据。
- 收藏状态第一版固定为：`拥有`、`想玩`、`玩过`、`心愿单`、`已出掉`。单个桌游可选一个状态。
- 基础信息第一版字段：
  - BGG ID、名称、年份、封面图、玩家人数、游戏时长、推荐年龄、BGG 评分、简介、设计师、分类/机制。
  - 若字段缺失，前端隐藏对应行，不显示空值。

## Interfaces

- `POST /api/auth/register/code`：发送注册邮箱验证码；邮箱已注册时返回明确错误。
- `POST /api/auth/register`：邮箱、昵称、密码、验证码注册，成功后写入登录会话。
- `POST /api/auth/login`：邮箱密码登录。
- `POST /api/auth/logout`：退出登录并清除会话。
- `GET /api/auth/me`：读取当前登录用户。
- `POST /api/auth/password-reset/code`：发送找回密码验证码；返回通用成功文案，不暴露账号是否存在。
- `POST /api/auth/password-reset/confirm`：校验验证码并设置新密码，清除旧会话，当前浏览器自动登录。
- `GET /api/boards`：读取当前用户白板列表。
- `POST /api/boards`：创建当前用户白板，支持传入 `title`，返回白板摘要；白板名称最长 20 个字符。
- `GET /api/boards/:boardId`：读取当前用户可编辑白板。
- `PUT /api/boards/:boardId`：保存当前用户白板个人数据，payload 包括 `title`、`viewport`、`items[id,bggId,x,y,scale,coverMode,note,status]` 和 `annotations`；服务端从本地 `games` 表恢复桌游主数据。
- `DELETE /api/boards/:boardId`：删除当前用户白板。
- `GET /api/share/:shareId`：公开只读读取分享白板。
- `GET /api/bgg/search?q=`：服务端本地优先搜索；本地无命中时 fallback 到 BGG `/xmlapi2/search?query=&type=boardgame`，返回标准化结果列表。
- `GET /api/bgg/things/:bggId`：服务端代理 BGG `/xmlapi2/thing?id=&type=boardgame&stats=1`，返回标准化桌游详情。
- `GET /api/bgg/things/:bggId/naming`：读取平台维护的本地名称和别名。MVP 不开放公开写入。
- `GET /api/covers/:bggId/:kind`：读取本地缓存封面，`kind` 为 `image` 或 `thumbnail`。
- `GET /api/admin/me`：返回当前管理员信息。
- `GET /api/admin/users?q=&status=&page=`：管理员用户列表。
- `PATCH /api/admin/users/:userId`：启用/禁用用户。
- `GET /api/admin/games?q=&page=`：管理员桌游列表。
- `GET /api/admin/games/:bggId`：管理员桌游详情。
- `PUT /api/admin/games/:bggId`：保存平台维护字段。
- `POST /api/admin/games/:bggId/refresh`：从 BGG 刷新详情。
- `GET /api/admin/analytics`：后台汇总、榜单和趋势数据。
- 语言参数：
  - 支持 `locale=en` / `locale=zh-CN` query。
  - 若未传 query，服务端可从 `Accept-Language` 归一化。
- 数据结构核心：
  - `User`: `id`, `nickname`, `email`, `createdAt`
  - `AdminUser`: `id`, `nickname`, `email`, `role`, `disabledAt`, `disabledReason`, `createdAt`, `updatedAt`
  - `Session`: `id`, `userId`, `tokenHash`, `expiresAt`, `createdAt`
  - `EmailVerificationCode`: `email`, `purpose`, `codeHash`, `attempts`, `expiresAt`, `consumedAt`, `lastSentAt`, `createdAt`, `requestIpHash`，`purpose` 为 `register` / `reset_password`。
  - `Board`: `id`, `ownerUserId`, `shareId`, `title`, `viewport`, `items`, `annotations`, `createdAt`, `updatedAt`
  - `BoardItem`: `id`, `bggId`, `x`, `y`, `scale`, `coverMode`, `note`, `status`, `gameSnapshot`
  - `BoardAnnotation`: `id`, `kind`, `x`, `y`, `width`, `height`, `text`, `style`, `createdAt`, `updatedAt`，`kind` 为 `text` / `sticky` / `section` / `rectangle` / `line` / `arrow`。
  - `BoardSavePayload`: `title`, `viewport`, `items[id,bggId,x,y,scale,coverMode,note,status]`, `annotations`，不包含 `gameSnapshot`。
  - `GameSnapshot`: API 返回给前端的桌游快照结构，包含可选 `displayName`、`canonicalName`、`localizedNames`、`aliases`、`localImage`、`localThumbnail`。
  - `Game`: 本地桌游主数据，按 `bggId` 唯一保存 BGG 详情，多个白板复用同一份桌游资料。
  - `GameLocalization`: `bggId`, `locale`, `name`, `source`, `updatedAt`。
  - `GameAlias`: `id`, `bggId`, `locale`, `alias`, `aliasSearch`, `source`, `updatedAt`。
  - `GameIndex`: BGG 全量游戏 CSV 的本地轻索引，只用于搜索和排序，不代表完整资料。

## Implementation Defaults

- 技术默认：Next.js 全栈应用 + SQLite 本地数据库；前端用 DOM 卡片实现无限画布，保留后续接入更复杂白板能力的空间。
- BGG Token 放在服务端环境变量，不暴露给浏览器。
- `ADMIN_EMAILS` 使用逗号分隔邮箱，统一小写去空格匹配；匹配后只自动授予 `admin`，不自动降级已有管理员。
- 邮件服务第一版使用阿里云 DirectMail / 邮件推送，发件地址为 `noreply@boardgamewb.com`；本地开发可用 `EMAIL_DELIVERY_MODE=console` 在服务端日志输出验证码。
- 邮箱验证码为 6 位数字，10 分钟有效；同一验证码最多尝试 5 次；同邮箱同用途发送冷却 60 秒，每小时最多 5 次；同 IP 每小时最多 20 次。
- 数据库只保存验证码哈希，哈希使用 `EMAIL_CODE_SECRET`；过期或已消费验证码在请求时顺手清理。
- `boardgamewb.com` 的 SPF、DKIM、DMARC、MX 等 DNS 记录以阿里云 DirectMail 控制台生成值为准。
- BGG 只作为补数据源：搜索和详情都优先复用本地数据库。本地没有时才请求 BGG。
- 搜索顺序：`game_localizations` 当前语言命中 -> `game_aliases` 当前语言命中 -> `games` 原名 -> `game_index` 英文轻索引 -> `bgg_cache` -> BGG XML。
- 所有真实 BGG XML 请求统一走服务端串行队列，默认 5200ms 间隔；同一路径并发请求复用同一个 in-flight 请求。
- BGG 搜索和详情结果做服务端缓存；搜索缓存 30 天，详情缓存 30 天；选中的桌游详情长期沉淀到本地 `games` 表。
- 封面图首次随详情获取时下载到本地 `.data/covers/:bggId/`，manifest 记录原始 URL、文件名、类型和缓存时间；前端优先加载 `/api/covers/:bggId/image`，失败时回退 BGG 原图 URL。
- 可通过 `npm run bgg:import-index` 下载 BGG 官方全量游戏 CSV 并导入 `game_index`，用于减少搜索阶段对 BGG 的请求。
- 白板上的位置、缩放、备注、收藏状态保存到 `board_items`；桌游基础资料保存到 `games`，避免同一个桌游在多个白板里重复请求 BGG。
- 白板整理工具对象保存到 `board_annotations`，通过 `board_id` 关联白板；删除白板时级联删除。
- 白板普通鼠标/触摸板滚动不触发画布缩放；仅保留触摸板 pinch 对画布缩放的控制。工具栏缩放按钮继续保留。
- 白板缩放快捷键：`-` 缩小，`=` 放大；输入框、备注框、下拉框聚焦时不触发快捷键。
- 桌游卡片 hover 信息面板需要在卡片层级内置顶，避免被其它卡片遮挡。
- 卡片封面比例模式保存到 `board_items.cover_mode`，可选值为 `native` / `uniform`。
- BGG 新详情写入 `games` 时自动写入英文 `game_localizations`；中文名和别名由平台/官方维护，CSV 导入不覆盖维护内容。
- 账号编辑权限只覆盖用户自己的白板个人数据：卡片位置、缩放、封面比例、收藏状态、备注。
- 收藏状态等业务值仍存稳定中文枚举，切换语言时只替换 UI 显示文案。
- 分享链接使用随机 `shareId`，不暴露数据库主键；后续可扩展为重置链接或关闭公开分享。
- MVP 不做改邮箱、邮件链接登录、历史版本、撤销/重做。
- 保存策略：默认自动保存，标题、视图、卡片位置、缩放、封面比例、备注、收藏状态和整理工具对象变更后防抖 `1200ms` 保存；工具栏不常驻保存按钮，保存失败时在底部状态区提供轻量重试。
- 自动保存任一时刻最多一个请求在路上；保存中继续编辑时，当前保存完成后补发最新版本。MVP 冲突策略仍为 last-write-wins。

## Test Plan

- 新用户先获取邮箱验证码，输入正确验证码后可注册并自动登录；错误、过期、超次数验证码失败；重复邮箱注册失败。
- 已注册邮箱请求注册验证码返回明确错误，不发送邮件。
- 找回密码对不存在邮箱返回通用成功文案；存在且未禁用的用户可收到验证码，正确验证码能更新密码、旧会话失效并自动登录。
- 禁用用户不能通过找回密码重新登录。
- 验证码发送冷却、小时频率限制和尝试次数限制生效；`EMAIL_DELIVERY_MODE=console` 时本地不调用阿里云。
- `ADMIN_EMAILS` 中的邮箱注册或登录后自动拥有后台权限；普通用户访问 `/admin` 和 `/api/admin/*` 返回无权限。
- 管理员可搜索用户、禁用/启用普通用户；不能禁用自己或其它管理员。
- 禁用用户后登录失败，现有会话失效，编辑 API 不可用；公开分享页仍可只读访问。
- 管理员可搜索桌游，保存中文名/别名/简介/术语翻译后，前台搜索和卡片展示立即使用新数据。
- 管理员刷新 BGG 详情失败时不破坏已有本地数据。
- 数据分析在空库、有用户无白板、有白板有卡片、有翻译数据时都能正常展示。
- 登录后能进入我的白板列表，新建白板后进入编辑页。
- 退出登录后无法访问白板列表和编辑接口。
- 分享链接未登录可只读打开，能看到封面、位置、收藏状态和备注，但不能编辑。
- 搜索英文桌游名能返回 BGG 列表，选择后卡片出现在画布上。
- 卡片显示封面，hover 能看到基础信息、备注和状态。
- 普通滚轮滚动不会改变画布缩放；触摸板 pinch 能改变画布缩放。
- `-` / `=` 快捷键能缩小/放大画布，表单输入状态下不误触。
- 右键卡片能打开菜单，并能切换原生比例 / A4 统一比例。
- 卡片 hover 菜单不被其它卡片压住。
- A4 统一比例下封面完整显示、不裁切；保存刷新后比例模式仍保留。
- 卡片移动、缩放、备注、状态修改后不点击保存，等待自动保存完成，刷新页面仍保留。
- 创建文字、便签、分区、矩形、直线、箭头后，等待自动保存完成，刷新页面仍保留位置、尺寸、文本和样式。
- 公开分享页能看到所有整理工具对象，但不能编辑、删除、拖动或调样式。
- 拖动整理对象接近其它整理对象的边缘或中心时，会自动磁吸并显示对齐参考线。
- `Esc`、`Delete` / `Backspace` 在输入框聚焦时不误触画布操作；未聚焦时可退出工具、取消选中或删除选中整理对象。
- 连续快速编辑备注只触发防抖后的少量保存请求，自动保存 payload 不包含 `gameSnapshot` 大字段。
- BGG 字段缺失、封面缺失、请求失败时页面不崩溃，并显示轻量错误/占位状态。
- 首次读取详情后，本地 `.data/covers/:bggId/` 存在封面文件；再次打开同一游戏时卡片优先使用本地封面 API。
- 用户不能读取、保存或删除其它账号的白板。
- 切换中文后，已有中文名的游戏卡片和搜索结果显示中文名；无中文名时回退英文名。
- 给游戏添加中文名和中文别名后，中文搜索语境下可用别名召回，并在结果中显示正式中文名。
- 切换英文后，同一游戏优先显示英文名；英文别名可在英文搜索语境下召回。
- 保存白板、刷新页面后，多语言名和别名仍保留。

## Assumptions

- 邮箱账号是当前 MVP 默认权限模型。
- 第一版同时包含备注和收藏状态。
- 产品优先做可分享的高级收藏墙，而不是重型收藏管理工具。
- 整理工具优先服务白板规划和展示，不把第一版扩展成完整绘图软件。
- BGG 数据只用于展示，不在 MVP 中做用户 BGG 账号登录或收藏同步。
- 前期只支持 `en` 和 `zh-CN`，不做 `zh-TW` 等地区细分。
- 中文名和别名主要靠平台/官方维护，不从 BGG 自动推断。
- 能编辑白板的人只能编辑自己的白板数据，不能编辑桌游主数据的名称和别名。
