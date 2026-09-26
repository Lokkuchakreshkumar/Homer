import assert from "node:assert/strict";
import { test } from "node:test";

import { createSiteMetadata, parsePublicSiteUrl } from "../lib/site-metadata.ts";

function imageUrl(image: unknown): string | undefined {
  if (typeof image === "string") {
    return image;
  }
  if (image instanceof URL) {
    return image.toString();
  }
  if (image && typeof image === "object" && "url" in image) {
    const url = image.url;
    return typeof url === "string" || url instanceof URL ? url.toString() : undefined;
  }
  return undefined;
}

test("metadata omits origin-dependent URLs when no public origin is configured", () => {
  const metadata = createSiteMetadata("");
  assert.equal(metadata.metadataBase, undefined);
  assert.equal(metadata.alternates, undefined);
  assert.equal(metadata.openGraph?.url, undefined);
  assert.equal(metadata.openGraph?.images, undefined);
  assert.equal(metadata.twitter?.images, undefined);
  assert.equal(JSON.stringify(metadata).includes("localhost"), false);
  assert.equal(JSON.stringify(metadata).includes("http://"), false);
  assert.equal(JSON.stringify(metadata).includes("https://"), false);
});

test("metadata uses a validated public origin when configured", () => {
  const metadata = createSiteMetadata("https://homer.example/");
  assert.equal(metadata.metadataBase?.toString(), "https://homer.example/");
  assert.equal(metadata.alternates?.canonical, "https://homer.example/");
  assert.equal(metadata.openGraph?.url, "https://homer.example/");
  const openGraphImages = metadata.openGraph?.images;
  const firstOpenGraphImage = Array.isArray(openGraphImages) ? openGraphImages[0] : openGraphImages;
  const twitterImages = metadata.twitter?.images;
  const firstTwitterImage = Array.isArray(twitterImages) ? twitterImages[0] : twitterImages;
  assert.equal(imageUrl(firstOpenGraphImage), "https://homer.example/og-image.png");
  assert.equal(firstTwitterImage, "https://homer.example/og-image.png");
});

test("invalid public origins fail with an actionable message", () => {
  assert.throws(
    () => parsePublicSiteUrl("not-an-origin"),
    /NEXT_PUBLIC_SITE_URL must be an absolute HTTP or HTTPS origin/,
  );
  assert.throws(() => parsePublicSiteUrl("ftp://homer.example"), /HTTP or HTTPS/);
  assert.throws(() => parsePublicSiteUrl("http://localhost:3000"), /public origin/);
  assert.throws(() => parsePublicSiteUrl("https://homer.example/path"), /without credentials/);
});
