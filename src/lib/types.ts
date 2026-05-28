export const BOARD_STATUSES = ["拥有", "想玩", "玩过", "心愿单", "已出掉"] as const;
export const SUPPORTED_LOCALES = ["en", "zh-CN"] as const;
export const CARD_COVER_MODES = ["native", "uniform"] as const;
export const USER_ROLES = ["user", "admin"] as const;
export const BOARD_ANNOTATION_KINDS = ["text", "sticky", "section", "rectangle", "line", "arrow"] as const;
export const BOARD_ANNOTATION_COLORS = ["ink", "moss", "brick", "navy", "amber", "cream"] as const;
export const BOARD_ANNOTATION_LINE_WIDTHS = [1, 2, 4] as const;
export const BOARD_ANNOTATION_FONT_SIZES = [14, 18, 24] as const;
export const EMAIL_CODE_PURPOSES = ["register", "reset_password"] as const;

export type BoardStatus = (typeof BOARD_STATUSES)[number];
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type CardCoverMode = (typeof CARD_COVER_MODES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type BoardAnnotationKind = (typeof BOARD_ANNOTATION_KINDS)[number];
export type BoardAnnotationColor = (typeof BOARD_ANNOTATION_COLORS)[number];
export type BoardAnnotationLineWidth = (typeof BOARD_ANNOTATION_LINE_WIDTHS)[number];
export type BoardAnnotationFontSize = (typeof BOARD_ANNOTATION_FONT_SIZES)[number];
export type EmailCodePurpose = (typeof EMAIL_CODE_PURPOSES)[number];

export type LocalizedText = Partial<Record<Locale, string>>;
export type LocalizedTextList = Partial<Record<Locale, string[]>>;
export type LocalizedAliases = Partial<Record<Locale, string[]>>;

export type Viewport = {
  x: number;
  y: number;
  scale: number;
};

export type BggSearchResult = {
  bggId: string;
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
  designers: string[];
  categories: string[];
  localizedCategories?: LocalizedTextList;
  mechanics: string[];
  localizedMechanics?: LocalizedTextList;
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
