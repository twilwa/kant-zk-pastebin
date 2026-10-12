// ABOUTME: Verifies static paste rendering against the real browser and IndexedDB.
// ABOUTME: Serves the shipped files and checks that paste fields remain inert text.
import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let server: Server;
let base: string;
const errors = new WeakMap<object, string[]>();

test.use({
  channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium',
  userAgent: 'OpenAI File Downloader, XaiImageApiFetch/1.0',
});

test.beforeAll(async () => {
  const root = resolve('static-pastebin');
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path === '/favicon.ico') {
      response.writeHead(204).end();
      return;
    }
    const files: Record<string, [string, string]> = {
      '/': ['index.html', 'text/html'],
      '/app.js': ['app.js', 'text/javascript'],
      '/style.css': ['style.css', 'text/css'],
    };
    const file = files[path];
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(resolve(root, file[0]));
      response.writeHead(200, { 'content-type': `${file[1]}; charset=utf-8` });
      response.end(body);
    } catch (error) {
      response.writeHead(500).end(String(error));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  base = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') messages.push(message.text());
  });
});

test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test('shared paste fields display literally without executing markup', async ({ page }) => {
  const title = `<img src="data:image/png;base64,invalid" onerror="document.body.dataset.injected='yes'"> O'Reilly & notes`;
  const paste = {
    title,
    content: 'A shared note with <tags> and Unicode: café',
    keywords: ['shared'],
    timestamp: '2026-10-12T19:53:00Z',
    ipfs_cid: '<svg onload="document.body.dataset.injected=\'yes\'"></svg>',
  };
  const fragment = Buffer.from(encodeURIComponent(JSON.stringify(paste))).toString('base64');
  await page.goto(`${base}/#paste=${fragment}`);
  await expect(page.locator('#result img, #result svg, #result script')).toHaveCount(0);
  await expect(page.locator('#result')).toContainText(title);
  await expect(page.locator('#result')).toContainText(paste.ipfs_cid);
  await expect(page.locator('#title')).toHaveValue(title);
  await expect(page.locator('#content')).toHaveValue(paste.content);
  await expect(page.locator('body')).not.toHaveAttribute('data-injected');
});

test('saved pastes keep markup literal through listing, viewing, and reload', async ({ page }) => {
  const title = `<img src="data:image/png;base64,invalid" onerror="document.body.dataset.injected='yes'"> O'Reilly & notes`;
  const content = 'Stored content with <tags> and café';
  await page.goto(base);
  await expect(page.locator('#pasteList')).toContainText('No pastes yet');
  await page.locator('#serverUrl').fill('');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '💾 Save', exact: true }).click();
  await page.locator('#title').fill(title);
  await page.locator('#content').fill(content);
  await page.locator('#keywords').fill('test, local');
  await page.getByRole('button', { name: '📤 Share', exact: true }).click();
  await expect(page.locator('#pasteList .paste-item')).toHaveCount(1);
  await expect(page.locator('#pasteList img, #pasteList svg')).toHaveCount(0);
  await expect(page.locator('#pasteList strong')).toHaveText(title);
  await page.getByRole('button', { name: 'View', exact: true }).click();
  await expect(page.locator('#content')).toHaveValue(content);
  await expect(page.locator('#title')).toHaveValue(title);
  await expect(page.locator('#result')).toContainText(title);
  await expect(page.locator('#result img, #result svg')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#pasteList strong')).toHaveText(title);
  await expect(page.locator('body')).not.toHaveAttribute('data-injected');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('#pasteList')).toContainText('No pastes yet');
  await page.reload();
  await expect(page.locator('#pasteList')).toContainText('No pastes yet');
});

test('synced paste metadata and QR actions preserve quotes and markup as data', async ({ page }) => {
  const title = `O'Reilly "notes" & <img src="data:image/png;base64,invalid" onerror="document.body.dataset.injected='yes'">`;
  const ipfsCid = '<svg onload="document.body.dataset.injected=\'yes\'"></svg>';
  await page.goto(base);
  await expect(page.locator('#pasteList')).toContainText('No pastes yet');
  await page.evaluate(async ({ title, ipfsCid, base }) => {
    localStorage.setItem('serverUrl', base);
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('kant-pastebin', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction('pastes', 'readwrite');
        transaction.objectStore('pastes').put({
          id: 'local-qr-paste',
          title,
          content: 'A real IndexedDB record for the QR flow',
          keywords: ['qr'],
          timestamp: '2026-10-12T19:53:00Z',
          synced: true,
          serverId: "remote'paste",
          ipfsCid,
        });
        transaction.oncomplete = () => { database.close(); resolve(); };
        transaction.onerror = () => { database.close(); reject(transaction.error); };
      };
    });
  }, { title, ipfsCid, base });
  await page.reload();
  await expect(page.locator('#pasteList strong')).toHaveText(title);
  await expect(page.locator('#pasteList code')).toHaveText('ipfs cat ' + ipfsCid);
  await expect(page.locator('#pasteList img, #pasteList svg')).toHaveCount(0);
  await page.getByRole('button', { name: '📱 QR Code', exact: true }).click();
  await expect(page.locator('h3')).toHaveText(title);
  await expect(page.locator('h3 img, h3 svg')).toHaveCount(0);
  await expect(page.locator('#qrcode')).toHaveAttribute('width', '256');
  const shareHandler = await page.getByRole('button', { name: '🔗 Share', exact: true }).getAttribute('onclick');
  expect(shareHandler).toBeTruthy();
  expect(() => new Function(shareHandler!)).not.toThrow();
  await expect(page.locator('body')).not.toHaveAttribute('data-injected');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#qrcode')).toHaveCount(0);
});

test('text and action values round-trip through real HTML parsing', async ({ page }) => {
  await page.goto(base);
  const values = ['plain', '<script>bad()</script>', 'quotes: "\' & < >', 'café 😀', 'backslash \\ and\nnewline'];
  const actual = await page.evaluate(values => values.map(value => {
    const target = document.createElement('div');
    const output = document.createElement('output');
    output.id = 'argument-output';
    document.body.appendChild(output);
    target.innerHTML = (window as any).escapeHtml(value);
    const text = target.textContent;
    const elements = target.childElementCount;
    target.innerHTML = '<button onclick="document.getElementById(\'argument-output\').textContent = ' +
      (window as any).actionArgument(value) + '">check</button>';
    document.body.appendChild(target);
    target.querySelector('button')!.click();
    const argument = output.textContent;
    target.remove();
    output.remove();
    return { text, elements, argument };
  }), values);
  expect(actual).toEqual(values.map(value => ({ text: value, elements: 0, argument: value })));
});
