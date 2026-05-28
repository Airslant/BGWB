import { withBasePath } from "@/lib/base-path";

export const BGG_HOME_URL = "https://boardgamegeek.com/";
export const BGG_ICON_URL = withBasePath("/assets/bgg/favicon.ico");
export const BGG_POWERED_LOGO_URL = withBasePath("/assets/bgg/powered-by-bgg.png");

export function getBggGameUrl(bggId: string) {
  return `${BGG_HOME_URL}boardgame/${encodeURIComponent(bggId)}`;
}

export function BggIcon() {
  return <img alt="" aria-hidden="true" className="bgg-icon" draggable={false} src={BGG_ICON_URL} />;
}

export function BggAttribution({ className = "" }: { className?: string }) {
  return (
    <a className={`bgg-attribution${className ? ` ${className}` : ""}`} href={BGG_HOME_URL} rel="noreferrer" target="_blank">
      <img alt="Powered by BoardGameGeek" className="bgg-powered-logo" draggable={false} src={BGG_POWERED_LOGO_URL} />
    </a>
  );
}
