// ABOUTME: Verifies gallery filters cannot inject executable markup into native pages.
// ABOUTME: Uses an actual uploaded image and browser against an isolated native server.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { chromium } from '@playwright/test';

const origin = process.env.NATIVE_TEST_ORIGIN;
if (!origin) throw new Error('NATIVE_TEST_ORIGIN must identify an isolated native test server');

test('gallery normalizes unknown filters and preserves supported filters', async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext({
      userAgent: 'OpenAI File Downloader, XaiImageApiFetch/1.0',
    });
    const uploaded = await context.request.post(`${origin}/upload`, {
      multipart: {
        file: {
          name: `gallery-${randomUUID()}.png`,
          mimeType: 'image/png',
          buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=', 'base64'),
        },
      },
    });
    assert.equal(uploaded.status(), 200, await uploaded.text());
    const page = await context.newPage();
    const payload = '\"><script>globalThis.__galleryInjected=true</script>';
    for (const param of ['time', 'cat']) {
      await page.goto(`${origin}/gallery?${param}=${encodeURIComponent(payload)}`);
      assert.equal(await page.evaluate(() => globalThis.__galleryInjected), undefined, param);
      assert.equal(await page.locator('script').count(), 0, param);
      assert.ok((await page.locator('body').textContent()).includes('Media Uploads'), param);
      assert.equal(await page.locator('a[href*="<script"]').count(), 0, param);
    }
    await page.goto(`${origin}/gallery?time=week&cat=image`);
    assert.ok((await page.locator('body').textContent()).includes('Media Uploads'));
    assert.ok(await page.locator('a[href*="time=week&cat=all"]').count());
    assert.ok(await page.locator('a[href*="time=today&cat=image"]').count());
  } finally {
    await browser.close();
  }
});
