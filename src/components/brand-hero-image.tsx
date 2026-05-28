import { withBasePath } from "@/lib/base-path";

const HERO_SIZES = "100vw";
const WEBP_SRC_SET = [
  "/assets/brand/bgwb-collection-wall-900.webp 900w",
  "/assets/brand/bgwb-collection-wall-1280.webp 1280w",
  "/assets/brand/bgwb-collection-wall-1720.webp 1720w"
]
  .map((entry) => {
    const [path, size] = entry.split(" ");
    return `${withBasePath(path)} ${size}`;
  })
  .join(", ");
const JPEG_SRC_SET = [
  "/assets/brand/bgwb-collection-wall-900.jpg 900w",
  "/assets/brand/bgwb-collection-wall-1280.jpg 1280w",
  "/assets/brand/bgwb-collection-wall-1720.jpg 1720w"
]
  .map((entry) => {
    const [path, size] = entry.split(" ");
    return `${withBasePath(path)} ${size}`;
  })
  .join(", ");

export function BrandHeroImage({ priority = false }: { priority?: boolean }) {
  return (
    <picture className="brand-hero-picture" aria-hidden="true">
      <source sizes={HERO_SIZES} srcSet={WEBP_SRC_SET} type="image/webp" />
      <source sizes={HERO_SIZES} srcSet={JPEG_SRC_SET} type="image/jpeg" />
      <img
        alt=""
        className="brand-hero-image"
        decoding="async"
        draggable={false}
        fetchPriority={priority ? "high" : "low"}
        loading="eager"
        sizes={HERO_SIZES}
        src={withBasePath("/assets/brand/bgwb-collection-wall-1280.jpg")}
        srcSet={JPEG_SRC_SET}
      />
    </picture>
  );
}
