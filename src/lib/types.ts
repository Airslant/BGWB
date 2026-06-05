export const BOARD_STATUSES = ["无", "拥有", "想玩", "玩过", "心愿单", "已出掉"] as const;
export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;
export const CARD_COVER_MODES = ["native", "uniform"] as const;
export const USER_ROLES = ["user", "admin"] as const;
export const BOARD_ANNOTATION_KINDS = [
  "text",
  "sticky",
  "section",
  "rectangle",
  "line",
  "arrow",
  "quadrant",
  "hotToLame",
  "topN",
  "table"
] as const;
export const BOARD_ANNOTATION_COLORS = ["ink", "moss", "brick", "navy", "amber", "cream"] as const;
export const BOARD_ANNOTATION_LINE_WIDTHS = [1, 2, 4] as const;
export const BOARD_ANNOTATION_FONT_SIZES = [14, 18, 24] as const;
export const EMAIL_CODE_PURPOSES = ["register", "reset_password"] as const;
export const BGG_THING_TYPES = ["boardgame", "boardgameexpansion"] as const;
export const VIEWPORT_SCALE_BASE = 0.5;
export const MIN_VIEWPORT_ZOOM = 0.25;
export const MAX_VIEWPORT_ZOOM = 4;
export const MIN_VIEWPORT_SCALE = VIEWPORT_SCALE_BASE * MIN_VIEWPORT_ZOOM;
export const MAX_VIEWPORT_SCALE = VIEWPORT_SCALE_BASE * MAX_VIEWPORT_ZOOM;
export const BGG_LINK_TYPES = [
  "boardgamedesigner",
  "boardgameartist",
  "boardgamepublisher",
  "boardgamecategory",
  "boardgamemechanic",
  "boardgamefamily",
  "boardgameexpansion",
  "boardgameimplementation",
  "boardgameintegration",
  "boardgamecompilation",
  "boardgameaccessory"
] as const;

export type BoardStatus = (typeof BOARD_STATUSES)[number];
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type CardCoverMode = (typeof CARD_COVER_MODES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type BoardAnnotationKind = (typeof BOARD_ANNOTATION_KINDS)[number];
export type BoardAnnotationColor = (typeof BOARD_ANNOTATION_COLORS)[number];
export type BoardAnnotationLineWidth = (typeof BOARD_ANNOTATION_LINE_WIDTHS)[number];
export type BoardAnnotationFontSize = (typeof BOARD_ANNOTATION_FONT_SIZES)[number];
export type EmailCodePurpose = (typeof EMAIL_CODE_PURPOSES)[number];
export type BggThingType = (typeof BGG_THING_TYPES)[number];
export type BggLinkType = (typeof BGG_LINK_TYPES)[number];

export type LocalizedText = Partial<Record<Locale, string>>;
export type LocalizedTextList = Partial<Record<Locale, string[]>>;
export type LocalizedAliases = Partial<Record<Locale, string[]>>;
export type BggLink = {
  id?: string;
  type: BggLinkType | string;
  name: string;
  inbound?: boolean;
};
export type BggLinksByType = Partial<Record<BggLinkType | string, BggLink[]>>;

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type BggSearchResult = {
  bggId: string;
  thingType?: BggThingType;
  name: string;
  displayName?: string;
  canonicalName?: string;
  localizedName?: string;
  matchedAlias?: string;
  locale?: Locale;
  yearPublished?: number;
  rank?: number;
  averageRating?: number;
  source?: "localization" | "alias" | "games" | "index" | "bgg";
};

export type GameSnapshot = {
  bggId: string;
  thingType?: BggThingType;
  name: string;
  displayName?: string;
  canonicalName?: string;
  localizedNames?: LocalizedText;
  aliases?: LocalizedAliases;
  locale?: Locale;
  yearPublished?: number;
  image?: string;
  thumbnail?: string;
  localImage?: string;
  localThumbnail?: string;
  minPlayers?: number;
  maxPlayers?: number;
  playingTime?: number;
  minPlayTime?: number;
  maxPlayTime?: number;
  minAge?: number;
  averageRating?: number;
  description?: string;
  localizedDescription?: LocalizedText;
  links?: BggLinksByType;
  designers: string[];
  designerLinks?: BggLink[];
  categories: string[];
  categoryLinks?: BggLink[];
  localizedCategories?: LocalizedTextList;
  mechanics: string[];
  mechanicLinks?: BggLink[];
  localizedMechanics?: LocalizedTextList;
  publishers?: string[];
  publisherLinks?: BggLink[];
  artists?: string[];
  artistLinks?: BggLink[];
  families?: string[];
  familyLinks?: BggLink[];
  expansions?: string[];
  expansionLinks?: BggLink[];
  implementations?: string[];
  implementationLinks?: BggLink[];
  integrations?: string[];
  integrationLinks?: BggLink[];
  compilations?: string[];
  compilationLinks?: BggLink[];
  accessories?: string[];
  accessoryLinks?: BggLink[];
};

export type BoardItem = {
  id: string;
  bggId: string;
  x: number;
  y: number;
  scale: number;
  coverMode: CardCoverMode;
  note: string;
  status: BoardStatus;
  gameSnapshot: GameSnapshot;
};

export type BoardItemSavePayload = Omit<BoardItem, "gameSnapshot"> & {
  gameSnapshot?: GameSnapshot;
};

export type BoardAnnotationStyle = {
  color: BoardAnnotationColor;
  lineWidth: BoardAnnotationLineWidth;
  fontSize: BoardAnnotationFontSize;
  fill: boolean;
  fillOpacity: number;
};

export type BoardAnnotation = {
  id: string;
  kind: BoardAnnotationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  style: BoardAnnotationStyle;
  createdAt: string;
  updatedAt: string;
};

export type BoardSavePayload = {
  title?: string;
  viewport?: Viewport;
  items?: BoardItemSavePayload[];
  annotations?: BoardAnnotation[];
};

export type User = {
  id: string;
  nickname: string;
  email: string;
  maxBoards: number;
  createdAt: string;
};

export type AdminUser = User & {
  role: UserRole;
  disabledAt: string | null;
  disabledReason: string | null;
  updatedAt: string;
};

export type AdminUserSummary = AdminUser & {
  boardCount: number;
  itemCount: number;
};

export type AdminGameSummary = {
  bggId: string;
  englishName: string;
  zhName: string;
  yearPublished?: number;
  itemCount: number;
  updatedAt: string;
};

export type AdminTermTranslation = {
  term: string;
  translation: string;
};

export type AdminGameDetail = AdminGameSummary & {
  lastFetchedAt: string;
  snapshot: GameSnapshot;
  localizedNames: LocalizedText;
  aliases: LocalizedAliases;
  zhDescription: string;
  categoryTranslations: AdminTermTranslation[];
  mechanicTranslations: AdminTermTranslation[];
};

export type AdminTranslationImportResult = {
  names: number;
  categories: number;
  mechanics: number;
  descriptions: number;
};

export type BoardSummary = {
  id: string;
  shareId: string;
  title: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Board = {
  id: string;
  shareId: string;
  title: string;
  viewport: Viewport;
  items: BoardItem[];
  annotations: BoardAnnotation[];
  createdAt: string;
  updatedAt: string;
};
