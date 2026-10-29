import { test, expect, type Locator, type Page } from '@playwright/test';

// These checks measure what the browser actually lays out: control boxes, scroll widths,
// resolved safe-area padding, and reduced-motion state. They do not read the stylesheet text.
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => { await page.request.post('/__test/reset'); });

/** Reads the next rendered frame, so a just-changed custom property has reached the cascade. */
async function nextFrame(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

/** Reduced motion must leave only near-zero transitions; WebKit keeps those listed until their next frame. */
async function expectMotionSettled(page: Page) {
  const durations = await page.evaluate(() => document.getAnimations()
    .filter(animation => animation.playState === 'running')
    .map(animation => Number(animation.effect?.getTiming().duration ?? 0)));
  expect(durations.every(duration => duration <= 1), 'running motion is reduced to a near-zero duration').toBe(true);
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'), undefined, { timeout: 2000 });
}

type Language = 'en' | 'ur';
const pinLabel = (language: Language) => language === 'ur' ? 'چار ہندسوں کا پن' : '4-digit PIN';
const homeHeading = (language: Language) => language === 'ur' ? 'ڈیش بورڈ' : 'Dashboard';

async function signIn(page: Page, language: Language = 'en') {
  await page.goto('/');
  await page.waitForSelector('.yf-people');
  if (language === 'ur') {
    if (await page.locator('html').getAttribute('lang') !== 'ur') await page.getByRole('button', { name: 'Switch language to Urdu' }).click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  }
  await page.getByRole('button', { name: 'Anas', exact: true }).click();
  await page.getByLabel(pinLabel(language)).fill('2468');
  await expect(page.getByRole('heading', { name: homeHeading(language), exact: true })).toBeVisible();
}

async function openPage(page: Page, hash: string, heading: string) {
  await page.evaluate(value => { location.hash = value; }, hash);
  await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
}

async function expectTarget(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} is rendered`).not.toBeNull();
  // WebKit can report a 44 px box as 43.99999 after subpixel layout; the target is still 44 CSS px.
  expect(box!.width, `${label} width`).toBeGreaterThanOrEqual(43.99);
  expect(box!.height, `${label} height`).toBeGreaterThanOrEqual(43.99);
}

/** Every standalone control on the current screen must meet the 44 px target. Inline prose links
    are intentionally excluded: they keep their natural line box and are covered by the inline exception. */
async function expectScreenTargets(page: Page, screen: string) {
  const undersized = await page.evaluate(() => {
    const visible = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    return [...document.querySelectorAll('button, select, summary, a.live-brand, a.button')]
      .filter(visible)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          label: (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().replace(/\s+/g, ' ').slice(0, 60),
          width: +rect.width.toFixed(1),
          height: +rect.height.toFixed(1),
        };
      })
      .filter(control => control.width < 43.99 || control.height < 43.99);
  });
  expect(undersized, `${screen} has controls below 44 × 44`).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, screen: string) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - innerWidth,
    content: (() => {
      const content = document.querySelector<HTMLElement>('.live-content');
      return content ? content.scrollWidth - content.clientWidth : 0;
    })(),
  }));
  expect(overflow.document, `${screen} document overflow`).toBeLessThanOrEqual(1);
  expect(overflow.content, `${screen} main content overflow`).toBeLessThanOrEqual(1);
}

async function expectPagesFit(page: Page, language: Language) {
  const prefix = language === 'ur' ? 'ur' : 'en';
  await expect(page.locator('html')).toHaveAttribute('lang', prefix);

  await openPage(page, '#/dashboard', homeHeading(language));
  await expectNoHorizontalOverflow(page, `${prefix} Dashboard`);
  await openPage(page, '#/notifications', language === 'ur' ? 'اطلاعات' : 'Notifications');
  await expectNoHorizontalOverflow(page, `${prefix} Notifications`);
  await openPage(page, '#/inventory', language === 'ur' ? 'اسٹاک' : 'Stock');
  await expectNoHorizontalOverflow(page, `${prefix} Stock`);
  await page.locator('.live-lot-row').first().click();
  await expect(page.locator('[data-page="batch"]')).toBeVisible();
  await expectNoHorizontalOverflow(page, `${prefix} batch detail`);
  await openPage(page, '#/scanner', language === 'ur' ? 'اسکین' : 'Scan');
  await expectNoHorizontalOverflow(page, `${prefix} Scan`);
  await openPage(page, '#/activity', language === 'ur' ? 'ہسٹری' : 'History');
  await expectNoHorizontalOverflow(page, `${prefix} History`);
  await openPage(page, '#/team', language === 'ur' ? 'ٹیم' : 'Team');
  await expectNoHorizontalOverflow(page, `${prefix} Team`);
  await openPage(page, '#/profile', language === 'ur' ? 'میری پروفائل' : 'My profile');
  await expectNoHorizontalOverflow(page, `${prefix} My profile`);
}

const viewports = [
  { name: '390 portrait', width: 390, height: 844 },
  { name: '844 landscape', width: 844, height: 390 },
  { name: '1440 desktop', width: 1440, height: 900 },
];

for (const language of ['en', 'ur'] as const) {
  test(`${language}: every screen fits every viewport without horizontal overflow`, async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.context().clearCookies();
      await page.goto('/');
      await page.waitForSelector('.yf-people');
      if (language === 'ur' && await page.locator('html').getAttribute('lang') !== 'ur') await page.getByRole('button', { name: 'Switch language to Urdu' }).click();
      await expectNoHorizontalOverflow(page, `${language} sign-in at ${viewport.name}`);
      await signIn(page, language);
      await expectPagesFit(page, language);
    }
  });
}

test('measured controls reach 44 × 44 at 390 px, including the save notice', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForSelector('.yf-people');

  for (const button of await page.locator('.yf-language button').all()) await expectTarget(button, 'sign-in language choice');
  for (const button of await page.locator('.yf-person').all()) await expectTarget(button, 'sign-in person');
  await expectTarget(page.locator('.yf-supplier-entry'), 'supplier sign-in link');
  await page.getByRole('button', { name: 'Anas', exact: true }).click();
  await expectTarget(page.locator('.yf-signin-back'), 'back to people');
  await expectTarget(page.locator('.yf-keypad button').first(), 'PIN keypad key');
  await page.getByLabel('4-digit PIN').fill('2468');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();

  await expectTarget(page.locator('.live-topbar .live-brand'), 'top bar brand');
  await expectTarget(page.locator('.live-bottom-nav button').first(), 'bottom navigation');
  await expectTarget(page.locator('.yf-head .live-text-button').filter({ hasText: 'See all' }), 'Dashboard See all');
  await expectScreenTargets(page, 'Dashboard');

  await openPage(page, '#/inventory', 'Stock');
  await expectScreenTargets(page, 'Stock');
  await page.locator('.live-lot-row').first().click();
  await expectTarget(page.locator('.yf-back'), 'batch back');
  await expectScreenTargets(page, 'batch detail');

  // A real confirmation notice: record one kilogram of waste, review, and save.
  await page.getByRole('button', { name: 'Record waste', exact: true }).click();
  await page.getByLabel('Weight (kg)', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Review entry', exact: true }).click();
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved. Everyone on the team sees it now.' })).toBeVisible();
  await expectTarget(page.locator('.live-success .live-icon-button'), 'notice dismiss');
  await expectTarget(page.locator('.live-success .live-text-button'), 'notice Undo');

  await openPage(page, '#/activity', 'History');
  const historyActions = page.locator('.live-history .live-text-button');
  for (const action of await historyActions.all()) await expectTarget(action, 'History text action');
  await expectScreenTargets(page, 'History');

  await openPage(page, '#/team', 'Team');
  await expectScreenTargets(page, 'Team');
  await openPage(page, '#/profile', 'My profile');
  await expectTarget(page.locator('.yf-language'), 'profile language switch');
  await expectScreenTargets(page, 'My profile');
  await openPage(page, '#/notifications', 'Notifications');
  await expectScreenTargets(page, 'Notifications');

  await openPage(page, '#/scanner', 'Scan');
  await expectScreenTargets(page, 'Scan');
});

test.describe('safe-area tokens', () => {
  test('physical insets move the matching edge in English', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.waitForSelector('.yf-people');
    const beforeSignIn = await page.evaluate(() => {
      const rail = getComputedStyle(document.querySelector('.yf-signin-rail')!);
      const sheet = getComputedStyle(document.querySelector('.yf-signin-sheet')!);
      return { railTop: parseFloat(rail.paddingTop), sheetTop: parseFloat(sheet.paddingTop), sheetBottom: parseFloat(sheet.paddingBottom) };
    });
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-top', '17px');
      document.documentElement.style.setProperty('--safe-right', '11px');
      document.documentElement.style.setProperty('--safe-bottom', '13px');
      document.documentElement.style.setProperty('--safe-left', '19px');
    });
    await nextFrame(page);
    const afterSignIn = await page.evaluate(() => {
      const rail = getComputedStyle(document.querySelector('.yf-signin-rail')!);
      const sheet = getComputedStyle(document.querySelector('.yf-signin-sheet')!);
      return { railTop: parseFloat(rail.paddingTop), sheetTop: parseFloat(sheet.paddingTop), sheetBottom: parseFloat(sheet.paddingBottom) };
    });
    expect(afterSignIn.railTop - beforeSignIn.railTop).toBeCloseTo(17, 0);
    // The stacked phone layout applies the top inset once, on the rail, not again on the sheet.
    expect(afterSignIn.sheetTop - beforeSignIn.sheetTop).toBeCloseTo(0, 0);
    expect(afterSignIn.sheetBottom - beforeSignIn.sheetBottom).toBeCloseTo(13, 0);

    await page.getByRole('button', { name: 'Anas', exact: true }).click();
    await page.getByLabel('4-digit PIN').fill('2468');
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
    const shell = await page.evaluate(() => {
      const read = (selector: string) => {
        const style = getComputedStyle(document.querySelector(selector)!);
        return { top: parseFloat(style.paddingTop), right: parseFloat(style.paddingRight), bottom: parseFloat(style.paddingBottom), left: parseFloat(style.paddingLeft) };
      };
      const tokens = ['--safe-top', '--safe-right', '--safe-bottom', '--safe-left', '--motion-fast', '--motion-standard']
        .map(name => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()]);
      return { topbar: read('.live-topbar'), content: read('.live-content'), nav: read('.live-bottom-nav'), tokens, dir: document.documentElement.dir };
    });
    expect(shell.dir).toBe('ltr');
    expect(shell.topbar).toEqual({ top: 17, right: 23, bottom: 0, left: 37 });
    expect(shell.content).toEqual({ top: 26, right: 29, bottom: 28, left: 37 });
    expect(shell.nav.right).toBeCloseTo(21, 0);
    expect(shell.nav.bottom).toBeCloseTo(21, 0);
    expect(shell.nav.left).toBeCloseTo(29, 0);
    for (const [name, value] of shell.tokens) expect(value, `${name} is defined`).not.toBe('');
    expect(shell.tokens.find(([name]) => name === '--motion-fast')![1]).toMatch(/^140ms$|^\.?14s$/);
    expect(shell.tokens.find(([name]) => name === '--motion-standard')![1]).toMatch(/^220ms$|^\.?22s$/);
    await expectNoHorizontalOverflow(page, 'English safe-area shell');

    await page.locator('.live-bottom-nav button').last().click();
    const menu = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.yf-mobile-menu')!);
      return { right: parseFloat(style.paddingRight), left: parseFloat(style.paddingLeft) };
    });
    expect(menu.right).toBeCloseTo(27, 0);
    expect(menu.left).toBeCloseTo(16, 0);
  });

  test('Urdu keeps the left inset on the physical left', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/');
    await page.waitForSelector('.yf-people');
    await page.getByRole('button', { name: 'Switch language to Urdu' }).click();
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--safe-left', '47px');
      document.documentElement.style.setProperty('--safe-right', '21px');
      document.documentElement.style.setProperty('--safe-bottom', '21px');
    });
    await page.getByRole('button', { name: 'Anas', exact: true }).click();
    await page.getByLabel(pinLabel('ur')).fill('2468');
    await expect(page.getByRole('heading', { name: homeHeading('ur'), exact: true })).toBeVisible();
    const shell = await page.evaluate(() => {
      const content = getComputedStyle(document.querySelector('.live-content')!);
      const nav = getComputedStyle(document.querySelector('.live-bottom-nav')!);
      return {
        dir: document.documentElement.dir,
        contentLeft: parseFloat(content.paddingLeft),
        contentRight: parseFloat(content.paddingRight),
        navLeft: parseFloat(nav.paddingLeft),
        navRight: parseFloat(nav.paddingRight),
        navBottom: parseFloat(nav.paddingBottom),
      };
    });
    expect(shell.dir).toBe('rtl');
    expect(shell.contentLeft).toBeCloseTo(18 + 47, 0);
    expect(shell.contentRight).toBeCloseTo(18 + 21, 0);
    expect(shell.navLeft).toBeCloseTo(10 + 47, 0);
    expect(shell.navRight).toBeCloseTo(10 + 21, 0);
    expect(shell.navBottom).toBeCloseTo(8 + 21, 0);
    await expectNoHorizontalOverflow(page, 'Urdu landscape safe-area shell');

    await page.locator('.live-bottom-nav button').last().click();
    const menu = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('.yf-mobile-menu')!);
      return { left: parseFloat(style.paddingLeft), right: parseFloat(style.paddingRight) };
    });
    expect(menu.left).toBeCloseTo(16 + 47, 0);
    expect(menu.right).toBeCloseTo(16, 0);
  });
});

test('reduced motion removes entrance animation and keeps state changes immediate', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page);
  await nextFrame(page);
  const state = await page.evaluate(() => {
    const duration = (selector: string) => getComputedStyle(document.querySelector(selector)!).transitionDuration.split(',').map(value => parseFloat(value));
    return {
      animations: document.getAnimations().filter(animation => animation.playState === 'running').length,
      firstSection: getComputedStyle(document.querySelector('.live-content > *')!).animationName,
      textButton: duration('.live-text-button'),
      endlessThread: getComputedStyle(document.querySelector('.yf-thread .yf-run') ?? document.body).animationName,
    };
  });
  expect(state.animations).toBe(0);
  expect(state.firstSection).toBe('none');
  expect(state.textButton.every(value => value <= 0.001)).toBe(true);
  expect(state.endlessThread).toBe('none');

  await page.locator('.live-bottom-nav button').nth(1).click();
  await expect(page.getByRole('heading', { name: 'Stock', exact: true })).toBeVisible();
  await expectMotionSettled(page);
});

test('numbers are tabular, headings balance, and supported squircle corners stay on panels', async ({ page }) => {
  await signIn(page);
  const home = await page.evaluate(() => {
    const style = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const computed = getComputedStyle(element);
      return { numeric: computed.fontVariantNumeric, wrap: computed.textWrap, corner: computed.cornerShape, radius: computed.borderTopLeftRadius };
    };
    return { heading: style('h1'), panel: style('.yf-next'), supportsSquircle: CSS.supports('corner-shape', 'squircle') };
  });
  expect(home.heading!.numeric).toBe('tabular-nums');
  expect(home.heading!.wrap).toBe('balance');
  if (home.supportsSquircle) {
    expect(home.panel!.corner).toMatch(/^(squircle|superellipse\(2\))$/);
    expect(home.panel!.radius).not.toBe('0px');
  }

  await openPage(page, '#/inventory', 'Stock');
  const type = await page.evaluate(() => {
    const style = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const computed = getComputedStyle(element);
      return { numeric: computed.fontVariantNumeric, wrap: computed.textWrap, corner: computed.cornerShape, radius: computed.borderTopLeftRadius };
    };
    return {
      body: style('body'),
      weight: style('.live-row-weight'),
      count: style('.yf-views b'),
      input: style('input[type="search"]'),
      pill: style('.yf-views button'),
    };
  });
  expect(type.body!.numeric).toBe('tabular-nums');
  expect(type.weight!.numeric).toBe('tabular-nums');
  expect(type.count!.numeric).toBe('tabular-nums');
  expect(type.input!.numeric).toBe('tabular-nums');
  if (home.supportsSquircle) {
    // Pills stay pills; the enhancement never reaches controls.
    expect(type.pill!.radius).toBe('999px');
  }

  await page.context().clearCookies();
  await page.goto('/');
  await page.waitForSelector('.yf-people');
  await page.getByRole('button', { name: 'Anas', exact: true }).click();
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.yf-keypad button')!).fontVariantNumeric)).toBe('tabular-nums');
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.yf-signin-step h1')!).textWrap)).toBe('balance');
});
