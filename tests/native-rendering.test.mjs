// ABOUTME: Verifies native paste rendering against a running backend with real browser requests.
// ABOUTME: Covers stored and reflected markup while preserving paste, reply, and preview behavior.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const origin = process.env.NATIVE_TEST_ORIGIN;
if (!origin) throw new Error('NATIVE_TEST_ORIGIN must identify an isolated native test server');
const userAgent = 'OpenAI File Downloader, XaiImageApiFetch/1.0';
let browser;
let context;

before(async () => {
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  context = await browser.newContext({ userAgent });
});
after(async () => { await browser?.close(); });

async function createPaste(fields) {
  const response = await context.request.post(`${origin}/paste`, { data: fields });
  assert.equal(response.status(), 200, await response.text());
  const paste = await response.json();
  assert.ok(paste.id);
  return paste;
}

test('home preserves a reflected reply target as a single inert form value', async () => {
  const page = await context.newPage();
  const value = '\"><svg onload="globalThis.__injected=true"></svg>';
  await page.goto(`${origin}/?reply_to=${encodeURIComponent(value)}`);
  assert.equal(await page.locator('#reply_to').inputValue(), value);
  assert.equal(await page.locator('svg').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__injected), undefined);
  const content = '<img src=x onerror="globalThis.__injected=true">';
  await page.locator('#content').fill(content);
  await page.getByRole('button', { name: 'Preview', exact: false }).click();
  assert.equal(await page.locator('img[src="x"]').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__injected), undefined);
  assert.equal(await page.locator('pre').textContent(), content);
  await page.close();
});

test('paste source and title stay literal, with working scripts and sandboxed preview', async () => {
  const nonce = randomUUID().slice(0, 8);
  const title = `${nonce} ' </script><svg onload="globalThis.__injected=true">`;
  const content = `<html><body><h2>Preview ${nonce}</h2><script>parent.__injected=true</script></body></html>`;
  const paste = await createPaste({ title, content });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/paste/${encodeURIComponent(paste.id)}`);
  assert.equal(await page.locator('h1').textContent(), title);
  assert.ok((await page.locator('pre').first().textContent()).includes(content));
  assert.equal(await page.locator('svg').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__injected), undefined);
  assert.equal(await page.evaluate(() => typeof showPreview), 'function');
  assert.equal(await page.evaluate(() => title), title);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const frame = page.locator('.preview-modal iframe');
  assert.equal(await frame.getAttribute('sandbox'), '');
  await frame.contentFrame().getByRole('heading', { name: `Preview ${nonce}` }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__injected), undefined);
  assert.deepEqual(errors, []);
  await page.close();
});

test('related posts, browse, search, and thread links render stored titles as text', async () => {
  const nonce = randomUUID().slice(0, 8);
  const title = `<img src=x onerror="globalThis.__injected=true"> ${nonce}`;
  const keywords = [`render-${nonce}`];
  const first = await createPaste({ title, content: `render ${nonce} first`, keywords });
  const second = await createPaste({ title: `Related ${nonce}`, content: `render ${nonce} second`, keywords, reply_to: first.id });
  const page = await context.newPage();
  for (const path of [`/paste/${second.id}`, '/browse', `/browse?q=${nonce}`, '/threads', `/thread/${first.id}`]) {
    await page.goto(`${origin}${path}`);
    assert.equal(await page.evaluate(() => globalThis.__injected), undefined, path);
    assert.equal(await page.locator('img[src="x"]').count(), 0, path);
    assert.ok((await page.locator('body').textContent()).includes(title), path);
  }
  await page.goto(`${origin}/paste/${second.id}`);
  await page.evaluate(() => toggleSidebar());
  await page.locator('#similarResults a').first().waitFor();
  assert.equal(await page.locator('#similarResults img').count(), 0);
  assert.equal(await page.evaluate(() => globalThis.__injected), undefined);
  await page.close();
});

test('browse search text cannot terminate an inline script', async () => {
  const page = await context.newPage();
  const query = '</script><svg onload="window.__injected=true">';
  await page.goto(`${origin}/browse?q=${encodeURIComponent(query)}`);
  assert.equal(await page.locator('input[name="q"]').inputValue(), query);
  assert.equal(await page.locator('svg').count(), 0);
  assert.equal(await page.evaluate(() => typeof exportVisible), 'function');
  assert.equal(await page.evaluate(() => typeof exportChunkedVisible), 'function');
  assert.equal(await page.evaluate(() => globalThis.__injected), undefined);
  await page.close();
});

test('archive filenames stay inert in headings and preview actions', async () => {
  const name = `archive-${randomUUID().slice(0, 8)}');globalThis.__injected=true;//.gz`;
  const response = await context.request.post(`${origin}/upload-archive`, {
    multipart: { file: { name, mimeType: 'application/gzip', buffer: gzipSync('Archive preview text') } },
  });
  assert.equal(response.status(), 200, await response.text());
  const archive = await response.json();
  const page = await context.newPage();
  await page.goto(`${origin}${archive.url}`);
  await page.locator('.preview-btn').first().click();
  await page.locator('#previewContent').filter({ hasText: 'Archive preview text' }).waitFor();
  assert.equal(await page.evaluate(() => globalThis.__injected), undefined);
  assert.equal(await page.locator('#previewContent').textContent(), 'Archive preview text');
  await page.close();
});

test('different pastes with the same title retain separate durable content', async () => {
  const title = `同名-${randomUUID().slice(0, 8)}`;
  const contents = Array.from({ length: 8 }, (_, i) => `${title}: content ${i}`);
  const pastes = await Promise.all(contents.map(content => createPaste({ title, content })));
  assert.equal(new Set(pastes.map(paste => paste.id)).size, contents.length);
  for (let i = 0; i < pastes.length; i++) {
    const response = await context.request.get(`${origin}/raw/${encodeURIComponent(pastes[i].id)}`);
    assert.equal(response.status(), 200);
    assert.ok((await response.text()).includes(contents[i]));
  }
});

test('bundle and split reject filesystem paths supplied as paste identifiers', async () => {
  const bundle = await context.request.post(`${origin}/api/bundle`, { data: { pastes: ['../outside'] } });
  assert.equal(bundle.status(), 400);
  const split = await context.request.post(`${origin}/api/split-paste`, { data: { paste_id: '../outside' } });
  assert.equal(split.status(), 400);
});

test('archive posting, generation, and splitting preserve repeated results', async () => {
  const response = await context.request.post(`${origin}/upload-archive`, {
    multipart: { file: { name: `repeat-${randomUUID()}.gz`, mimeType: 'application/gzip', buffer: gzipSync('Archive durable text') } },
  });
  assert.equal(response.status(), 200, await response.text());
  const archive = await response.json();
  const session = archive.url.split('/').pop();
  const preview = await context.request.get(`${origin}/archive-preview/${session}/0`);
  const entry = await preview.json();
  for (const action of ['archive-post-file', 'archive-generate', 'archive-split']) {
    const results = await Promise.all([0, 1].map(async () => {
      const url = `${origin}/${action}/${session}${action === 'archive-post-file' ? '/0' : ''}`;
      const result = await context.request.post(url, { data: { files: [entry.path] } });
      assert.equal(result.status(), 200, await result.text());
      return result.json();
    }));
    assert.notEqual(results[0].url, results[1].url, action);
    for (const result of results) {
      const saved = await context.request.get(`${origin}${result.url}`);
      assert.equal(saved.status(), 200, action);
    }
  }
});

test('archive preview sessions reject uploads when the bounded cache is full', async () => {
  const statuses = [];
  for (let i = 0; i < 10; i++) {
    const response = await context.request.post(`${origin}/upload-archive`, {
      multipart: { file: { name: `capacity-${randomUUID()}.gz`, mimeType: 'application/gzip', buffer: gzipSync(`Session ${i}`) } },
    });
    statuses.push(response.status());
  }
  assert.ok(statuses.includes(429), `Expected an archive capacity rejection, got ${statuses}`);
  assert.ok(statuses.every(status => status === 200 || status === 429));
});
