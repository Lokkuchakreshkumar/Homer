import type { Metadata } from "next";

import { content } from "../data/content.ts";

const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export function parsePublicSiteUrl(value: string | undefined): URL | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an absolute HTTP or HTTPS origin.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SITE_URL must use HTTP or HTTPS.");
  }
  if (localHosts.has(parsed.hostname)) {
    throw new Error("NEXT_PUBLIC_SITE_URL must use a public origin, not localhost.");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an origin without credentials, a path, query, or fragment.");
  }

  return new URL(parsed.origin);
}

export function createSiteMetadata(value: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): Metadata {
  const siteUrl = parsePublicSiteUrl(value);
  const canonicalUrl = siteUrl ? new URL("/", siteUrl).toString() : undefined;
  const imageUrl = siteUrl ? new URL("/og-image.png", siteUrl).toString() : undefined;
  const openGraphImages = imageUrl
    ? [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: content.site.socialImageAlt,
        },
      ]
    : undefined;

  return {
    ...(siteUrl
      ? {
          metadataBase: siteUrl,
          alternates: { canonical: canonicalUrl },
        }
      : {}),
    title: content.site.title,
    description: content.site.description,
    openGraph: {
      type: "website",
      ...(canonicalUrl ? { url: canonicalUrl } : {}),
      ...(openGraphImages ? { images: openGraphImages } : {}),
      title: content.site.title,
      description: content.site.description,
      siteName: content.site.name,
    },
    twitter: {
      card: "summary_large_image",
      ...(imageUrl ? { images: [imageUrl] } : {}),
      title: content.site.title,
      description: content.site.description,
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
  };
}

export const metadata: Metadata = createSiteMetadata();
