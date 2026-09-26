import { access } from "node:fs/promises";

import { check, LinkState } from "linkinator";

await access("out/og-image.png");

const checkExternalLinks = process.env.CHECK_EXTERNAL_LINKS === "1";
const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const result = await check({
  path: "out/index.html",
  recurse: true,
  checkFragments: true,
  cleanUrls: true,
  timeout: 20_000,
  concurrency: 4,
  requireHttps: checkExternalLinks ? "error" : "off",
  linksToSkip: async (href) => {
    if (checkExternalLinks) {
      return false;
    }
    try {
      const url = new URL(href);
      return (url.protocol === "http:" || url.protocol === "https:") && !localHosts.has(url.hostname);
    } catch {
      return false;
    }
  },
});

const broken = result.links.filter((link) => link.state === LinkState.BROKEN);
for (const link of broken) {
  process.stderr.write(`${link.state} ${link.status ?? ""} ${link.url}\n`);
}

if (!result.passed || broken.length > 0) {
  process.exitCode = 1;
} else if (checkExternalLinks) {
  process.stdout.write(`Checked ${result.links.length} links, including external URLs; no broken links found.\n`);
} else {
  const skipped = result.links.filter((link) => link.state === LinkState.SKIPPED).length;
  process.stdout.write(`Checked ${result.links.length} links; no broken internal links found. ${skipped} external links were not requested.\n`);
  process.stdout.write("Run npm run test:links:external to include external URLs.\n");
}
