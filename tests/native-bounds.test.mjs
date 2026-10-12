// ABOUTME: Checks that native export and split APIs reject excessive amplification.
// ABOUTME: Uses small real pastes and archives to exercise output bounds safely.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { before, test } from 'node:test';

const origin = process.env.NATIVE_TEST_ORIGIN;
if (!origin) throw new Error('NATIVE_TEST_ORIGIN must identify an isolated native test server');
const ua = 'OpenAI File Downloader, XaiImageApiFetch/1.0';
const post = (path, data) => fetch(origin + path, {
  method: 'POST',
  headers: { 'User-Agent': ua, 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});
let paste;
let archive;
let archivePath;

before(async () => {
  const response = await post('/paste', { title: 'Bounds ' + randomUUID(), content: 'Small source content' });
  const created = await response.text();
  assert.equal(response.status, 200, created.slice(0, 1000));
  paste = JSON.parse(created);
  const form = new FormData();
  const name = 'bounds-' + randomUUID() + '.txt.gz';
  form.set('file', new Blob([gzipSync('Small archive content')], { type: 'application/gzip' }), name);
  const uploaded = await fetch(origin + '/upload-archive', { method: 'POST', headers: { 'User-Agent': ua }, body: form });
  const body = await uploaded.text();
  assert.equal(uploaded.status, 200, body);
  archive = JSON.parse(body);
  const entry = await fetch(origin + '/archive-preview/' + archive.session_id + '/0', { headers: { 'User-Agent': ua } });
  assert.equal(entry.status, 200);
  archivePath = (await entry.json()).path;
  assert.ok(archivePath);
});

test('bundle rejects excessive repeated paste selections before collecting content', async () => {
  const response = await post('/api/bundle', { pastes: Array(1025).fill(paste.id) });
  assert.equal(response.status, 413, (await response.text()).slice(0, 1000));
});

for (const path of ['/api/search-results-bundle', '/api/search-results-chunks']) {
  test(path + ' rejects excessive repeated result selections', async () => {
    const response = await post(path, { results: Array.from({ length: 1025 }, () => ({ id: paste.id })) });
    assert.equal(response.status, 413, (await response.text()).slice(0, 1000));
  });
}

for (const path of ['/archive-generate/', '/archive-split/']) {
  test(path + ' rejects excessive repeated archive selections', async () => {
    const response = await post(path + archive.session_id, { files: Array(1025).fill(archivePath) });
    assert.equal(response.status, 413, (await response.text()).slice(0, 1000));
  });
}

test('split upload rejects a request producing over 1024 files', async () => {
  const response = await post('/api/split-upload', {
    title: 'bounds-' + randomUUID(),
    content: 'a'.repeat(1025),
    chunk_size: 1,
    unit: 'byte',
    split_mode: 'exact',
  });
  assert.equal(response.status, 413, (await response.text()).slice(0, 1000));
});
