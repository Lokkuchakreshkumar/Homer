import { expect, test, type Locator, type Page } from "@playwright/test";

import { content } from "../data/content";

const localOrigin = "http://127.0.0.1:4173";
const terrainFixture = content.demo.fixtures[0];
const samplesFixture = content.demo.fixtures[1];

function demoRegion(page: Page) {
  return page.getByRole("region", { name: content.demo.labels.documentLabel });
}

async function tabTo(page: Page, target: Locator) {
  await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
}

async function focusRing(locator: Locator) {
  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
}

async function expectVisibleFocus(locator: Locator) {
  await expect(locator).toBeFocused();
  const ring = await focusRing(locator);
  expect(ring.outlineStyle).not.toBe("none");
  expect(ring.outlineWidth).toBeGreaterThanOrEqual(2);
  return ring;
}

function colorChannels(value: string): [number, number, number] {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Unsupported color: ${value}`);
  }
  return channels as [number, number, number];
}

function channel(value: number): number {
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(value: string): number {
  const [red, green, blue] = colorChannels(value);
  return 0.2126 * channel(red / 255) + 0.7152 * channel(green / 255) + 0.0722 * channel(blue / 255);
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

test("renders the useful page and keeps the local demo request-free", async ({ page }) => {
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== localOrigin) {
      externalRequests.push(requestUrl.toString());
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await expect(page).toHaveTitle(content.site.title);
  await expect(page.locator("h1")).toHaveText(content.site.promise);
  await expect(page.locator("#product")).toBeVisible();
  const heroFrame = page.getByRole("region", { name: content.heroWindow.ariaLabel });
  await expect(heroFrame.getByText(terrainFixture.answer.emphasis, { exact: true })).toBeVisible();
  await expect(page.getByLabel(content.demo.labels.inputLabel)).toHaveValue("");
  await expect(page.getByLabel(content.demo.labels.inputLabel)).toHaveAttribute("placeholder", content.demo.queries[0].text);
  await expect(page.getByRole("status")).toContainText(content.demo.status.idle);
  await expect(page.getByRole("button", { name: "Show context" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();
  await expect(demoRegion(page).getByText(content.demo.labels.noAnswerTitle, { exact: true })).toBeHidden();

  await page.getByRole("radio", { name: "Unsafe terrain" }).check();
  await expect(page.getByRole("status")).toContainText(`${content.demo.status.answered} 04`);
  await expect(demoRegion(page).getByText(terrainFixture.answer.emphasis, { exact: true })).toBeVisible();
  await expect(demoRegion(page).getByText(samplesFixture.answer.emphasis, { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Show context" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Replay" })).toBeEnabled();

  await page.getByRole("button", { name: "Show context" }).click();
  await expect(page.getByRole("status")).toContainText(content.demo.status.context);
  await expect(demoRegion(page).getByText(terrainFixture.context, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show context" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Replay" })).toBeEnabled();

  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.getByRole("status")).toContainText(`${content.demo.status.replayContext} 04`);
  await expect(demoRegion(page).getByText(terrainFixture.context, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show context" })).toBeDisabled();

  await page.getByRole("radio", { name: "No answer" }).check();
  await expect(page.getByRole("status")).toContainText(content.demo.status.absent);
  await expect(demoRegion(page).getByText(content.demo.labels.noAnswerTitle, { exact: true })).toBeVisible();
  await expect(demoRegion(page).getByText(terrainFixture.answer.emphasis, { exact: true })).toBeHidden();
  await expect(demoRegion(page).getByText(samplesFixture.answer.emphasis, { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Show context" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByRole("status")).toContainText(content.demo.status.reset);
  await expect(page.getByRole("status")).toContainText(content.demo.status.idle, { timeout: 1_500 });
  expect(externalRequests).toEqual([]);
});

test("accepts only approved sample questions and clears old results", async ({ page }) => {
  await page.goto("/");
  const input = page.getByLabel(content.demo.labels.inputLabel);
  await page.getByRole("radio", { name: "Unsafe terrain" }).check();
  await expect(demoRegion(page).getByText(terrainFixture.answer.emphasis, { exact: true })).toBeVisible();

  await input.fill("");
  await input.press("Enter");
  await expect(page.locator("#demo-query-error")).toHaveText(content.demo.validation.emptyQuery);

  await input.fill("   \n\t");
  await input.press("Enter");
  await expect(page.locator("#demo-query-error")).toHaveText(content.demo.validation.emptyQuery);
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(demoRegion(page).getByText(content.demo.labels.noAnswerTitle, { exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Replay" })).toBeDisabled();

  await input.fill("How do I find a hidden passage?");
  await input.press("Enter");
  await expect(page.locator("#demo-query-error")).toHaveText(content.demo.validation.unsupportedQuery);
  await expect(page.getByRole("status")).toContainText(content.demo.status.unsupported);
  await expect(demoRegion(page).getByText(content.demo.labels.noAnswerTitle, { exact: true })).toBeHidden();

  await input.fill(content.demo.queries[1].text);
  await expect(page.locator("#demo-query-error")).toHaveCount(0);
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await expect(demoRegion(page).getByText(samplesFixture.answer.emphasis, { exact: true })).toBeHidden();
  await input.press("Enter");
  await expect(demoRegion(page).getByText(samplesFixture.answer.emphasis, { exact: true })).toBeVisible();

  await input.fill("A newly typed question");
  await expect(demoRegion(page).getByText(terrainFixture.answer.emphasis, { exact: true })).toBeHidden();
  await expect(demoRegion(page).getByText(samplesFixture.answer.emphasis, { exact: true })).toBeHidden();
  await expect(demoRegion(page).getByText(content.demo.labels.noAnswerTitle, { exact: true })).toBeHidden();
});

test("keeps fixed anchors, FAQ names, and a state-aware mobile menu accessible", async ({ page }) => {
  await page.goto("/");
  const fixedAnchors = await page.locator('a[href^="#"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute("href")).filter((href): href is string => Boolean(href)),
  );
  for (const href of new Set(fixedAnchors)) {
    await expect(page.locator(href)).toHaveCount(1);
  }

  await page.getByRole("link", { name: "See it in action" }).click();
  await expect(page).toHaveURL(/#product$/);
  await expect(page.locator("#product")).toBeInViewport();

  const faq = page.locator("#faq");
  await expect(faq).toHaveAttribute("aria-labelledby", "faq-title");
  const firstQuestion = faq.locator("summary").first();
  const firstDetails = faq.locator("details").first();
  await expect(firstQuestion).toHaveAccessibleName(content.faq.items[0].question);
  await expect(firstDetails).toHaveAttribute("open", "");
  await firstQuestion.click();
  await expect(firstDetails).not.toHaveAttribute("open", "");

  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.locator(".mobile-menu");
  const summary = menu.locator("summary");
  await expect(summary).toHaveAttribute("aria-label", "Open navigation menu");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  await summary.focus();
  expect(await summary.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  await summary.click();
  await expect(summary).toHaveAttribute("aria-label", "Close navigation menu");
  await expect(summary).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(summary).toHaveAttribute("aria-label", "Open navigation menu");
  await expect(summary).toHaveAttribute("aria-expanded", "false");
  const controlHeights = await page
    .locator(".demo-input-row input, .demo-input-row .button, .query-chip, .demo-action-list .button")
    .evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().height));
  expect(controlHeights.length).toBeGreaterThan(0);
  expect(Math.min(...controlHeights)).toBeGreaterThanOrEqual(44);
  await page.setViewportSize({ width: 320, height: 844 });
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  const closingDocumentation = page.getByRole("link", { name: content.closing.documentation.label });
  await expect(closingDocumentation).toHaveAttribute("href", content.closing.documentation.href);
  await expect(closingDocumentation).toHaveAttribute("rel", "noopener noreferrer");
});

test("keeps keyboard focus order and visible rings across the main path", async ({ page }) => {
  await page.goto("/");

  const skipLink = page.locator(".skip-link");
  const wordmark = page.locator(".site-header .wordmark");
  const headerLinks = page.locator(".desktop-navigation a");
  const headerAction = page.locator(".header-action");
  const heroActions = page.locator(".hero-actions");
  const heroPrimary = heroActions.getByRole("link", { name: content.site.primaryAction });
  const heroSecondary = heroActions.getByRole("link", { name: content.site.secondaryAction });
  const problemLink = page.locator("#problem .stage-footer .text-link");
  const demoInput = page.getByLabel(content.demo.labels.inputLabel);
  const findButton = page.getByRole("button", { name: content.demo.labels.findAction, exact: true });
  const terrainRadio = page.getByRole("radio", { name: "Unsafe terrain" });
  const samplesRadio = page.getByRole("radio", { name: "Sample storage" });
  const absentRadio = page.getByRole("radio", { name: "No answer" });
  const terrainChip = page.locator(".query-chip").filter({ has: terrainRadio }).locator("span");
  const samplesChip = page.locator(".query-chip").filter({ has: samplesRadio }).locator("span");
  const absentChip = page.locator(".query-chip").filter({ has: absentRadio }).locator("span");
  const showContext = page.getByRole("button", { name: "Show context" });
  const replay = page.getByRole("button", { name: "Replay" });
  const reset = page.getByRole("button", { name: "Reset" });
  const howLink = page.locator("#how-it-works .section-link");
  const privacyLink = page.locator("#privacy .section-link");

  await tabTo(page, skipLink);
  await tabTo(page, wordmark);
  const wordmarkRing = await expectVisibleFocus(wordmark);
  expect(contrastRatio(wordmarkRing.outlineColor, "rgb(255, 254, 250)")).toBeGreaterThanOrEqual(3);

  await tabTo(page, headerLinks.nth(0));
  await expectVisibleFocus(headerLinks.nth(0));
  await tabTo(page, headerLinks.nth(1));
  await expectVisibleFocus(headerLinks.nth(1));
  await tabTo(page, headerLinks.nth(2));
  await expectVisibleFocus(headerLinks.nth(2));
  await tabTo(page, headerLinks.nth(3));
  await expectVisibleFocus(headerLinks.nth(3));
  await tabTo(page, headerAction);
  await expectVisibleFocus(headerAction);

  await tabTo(page, heroPrimary);
  const heroRing = await expectVisibleFocus(heroPrimary);
  expect(contrastRatio(heroRing.outlineColor, "rgb(255, 254, 250)")).toBeGreaterThanOrEqual(3);
  await tabTo(page, heroSecondary);
  await expectVisibleFocus(heroSecondary);

  await tabTo(page, problemLink);
  await expectVisibleFocus(problemLink);
  await tabTo(page, demoInput);
  await expectVisibleFocus(demoInput);
  await tabTo(page, findButton);
  await expectVisibleFocus(findButton);
  await tabTo(page, terrainRadio);
  await expect(terrainRadio).toBeFocused();
  const terrainRing = await focusRing(terrainChip);
  expect(terrainRing.outlineStyle).not.toBe("none");
  expect(terrainRing.outlineWidth).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Space");

  await page.keyboard.press("ArrowDown");
  await expect(samplesRadio).toBeFocused();
  const samplesRing = await focusRing(samplesChip);
  expect(samplesRing.outlineStyle).not.toBe("none");
  expect(samplesRing.outlineWidth).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("ArrowDown");
  await expect(absentRadio).toBeFocused();
  const absentRing = await focusRing(absentChip);
  expect(absentRing.outlineStyle).not.toBe("none");
  expect(absentRing.outlineWidth).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(terrainRadio).toBeFocused();
  await tabTo(page, showContext);
  await expectVisibleFocus(showContext);
  await tabTo(page, replay);
  await expectVisibleFocus(replay);
  await tabTo(page, reset);
  await expectVisibleFocus(reset);

  await tabTo(page, howLink);
  await expectVisibleFocus(howLink);
  await tabTo(page, privacyLink);
  const privacyRing = await expectVisibleFocus(privacyLink);
  const privacyBackground = await privacyLink.evaluate((element) => {
    const section = element.closest(".section-privacy");
    return section ? window.getComputedStyle(section).backgroundColor : "";
  });
  expect(contrastRatio(privacyRing.outlineColor, privacyBackground)).toBeGreaterThanOrEqual(3);
});

test("does not emit localhost metadata without a public origin", async ({ page }) => {
  await page.goto("/");
  const metadataUrls = await page
    .locator('link[rel="canonical"], meta[property="og:url"], meta[property="og:image"], meta[name="twitter:image"]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("content") ?? element.getAttribute("href") ?? ""));
  expect(metadataUrls.filter((url) => url.includes("localhost"))).toEqual([]);
});

test("serves the no-JavaScript content and install fallback", async ({ browser }) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(content.site.promise);
  await expect(page.locator(".noscript-note")).toBeVisible();
  await expect(page.locator(".noscript-note")).toContainText("install the current source build");
  await expect(page.locator("#install")).toBeVisible();
  await context.close();
});

test("removes result motion when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("radio", { name: "Unsafe terrain" }).check();
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(page.getByRole("status")).toContainText(content.demo.status.replayAnswer);
  const animation = await demoRegion(page)
    .getByText(terrainFixture.answer.emphasis, { exact: true })
    .evaluate((element) => getComputedStyle(element).animationName);
  expect(animation).toBe("none");
});

test("keeps the redesign arc in order from hero proof to closing action", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(content.site.promise);
  const heroFrame = page.getByRole("region", { name: content.heroWindow.ariaLabel });
  await expect(heroFrame.getByText(content.heroFrame.query, { exact: false })).toBeVisible();
  await expect(heroFrame.getByText(terrainFixture.answer.emphasis, { exact: true })).toBeVisible();

  const comparison = page.locator(".problem-comparison");
  const exactBox = await comparison.locator(".problem-card-exact").boundingBox();
  const meaningBox = await comparison.locator(".problem-card-meaning").boundingBox();
  expect(exactBox).not.toBeNull();
  expect(meaningBox).not.toBeNull();
  expect(exactBox?.x).toBeLessThan(meaningBox?.x ?? Number.POSITIVE_INFINITY);
  await expect(comparison.getByText(content.problem.meaningTitle, { exact: true })).toBeVisible();

  await expect(page.locator(".workflow-grid .workflow-card")).toHaveCount(content.how.steps.length);
  for (const step of content.how.steps) {
    await expect(page.locator("#how-it-works").getByText(step.title, { exact: true })).toBeVisible();
  }

  await expect(page.locator("#privacy").getByText(content.privacy.flow.proxyBody, { exact: false })).toBeVisible();
  await expect(page.locator(".install-list li")).toHaveCount(content.install.steps.length);
  await expect(page.locator(".faq-list details")).toHaveCount(content.faq.items.length);

  const closing = page.locator(".closing-card");
  await expect(closing.getByRole("link", { name: content.site.primaryAction })).toBeVisible();
  await expect(closing.getByRole("link", { name: content.closing.documentation.label })).toHaveAttribute(
    "href",
    content.closing.documentation.href,
  );
});
