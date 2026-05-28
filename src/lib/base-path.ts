const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const BASE_PATH = configuredBasePath === "/" ? "" : configuredBasePath.replace(/\/$/, "");

export function withBasePath(path: string) {
  if (!BASE_PATH || !path.startsWith("/")) {
    return path;
  }

  if (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`)) {
    return path;
  }

  return `${BASE_PATH}${path}`;
}
