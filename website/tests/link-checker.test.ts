import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { check, LinkState } from "linkinator";

test("the link checker reports a broken internal page", async () => {
  const directory = await mkdtemp(join(tmpdir(), "homer-link-check-"));
  const indexPath = join(directory, "index.html");
  await writeFile(indexPath, '<a href="/missing.html">Missing page</a>');
  try {
    const result = await check({
      path: indexPath,
      recurse: false,
      checkFragments: true,
      cleanUrls: true,
      timeout: 5_000,
      concurrency: 1,
      requireHttps: "off",
    });
    assert.equal(result.passed, false);
    assert.ok(result.links.some((link) => link.state === LinkState.BROKEN && link.url.endsWith("/missing.html")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
