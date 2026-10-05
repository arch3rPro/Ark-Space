// Prototype state-model checks only; not browser, real TUI, credential or API tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ URL, structuredClone });
vm.runInContext(fs.readFileSync(__dirname + '/prototype-model.js', 'utf8'), context);
const create = context.ArkSetupPrototype.createPrototypeModel;

const resources = m => m.snapshot().providers.exa.resources;

test('scenarios have real fixture rows and detached snapshots', () => {
  assert.equal(resources(create('empty')).length, 0);
  assert.equal(resources(create('many12')).length, 12);
  const m = create(); const s = m.snapshot();
  s.providers.exa.resources.length = 0;
  assert.equal(resources(m).length, 2);
});

test('add saves one synthetic object and selects it; cancel preserves original selection', () => {
  const m = create(); const original = m.snapshot().selected.exa;
  m.dispatch('editor-open', { mode: 'add' }); m.dispatch('cancel');
  assert.equal(resources(m).length, 2); assert.equal(m.snapshot().selected.exa, original);
  m.dispatch('editor-open', { mode: 'add' });
  const result = m.dispatch('editor-save');
  assert.equal(result.status, 'saved'); assert.equal(resources(m).length, 3);
  assert.equal(m.snapshot().selected.exa, result.ref);
});

test('confirmation defaults to no and deletion selects the adjacent stable object', () => {
  const m = create(); const original = m.snapshot().selected.exa;
  m.dispatch('remove-request'); m.dispatch('confirm');
  assert.equal(resources(m).length, 2); assert.equal(m.snapshot().selected.exa, original);
  m.dispatch('remove-request'); m.dispatch('confirm', { yes: true });
  assert.equal(resources(m).length, 1);
  assert.equal(m.snapshot().selected.exa, resources(m)[0].ref);
});

test('environment replacement is blocked; shared reference may be unlinked, not replaced', () => {
  const external = create('external');
  assert.equal(external.dispatch('editor-open', { mode: 'replace' }).status, 'error');
  const m = create('owned'); const shared = resources(m)[1].ref;
  m.dispatch('select', { ref: shared });
  assert.equal(m.dispatch('editor-open', { mode: 'replace' }).status, 'error');
  assert.equal(m.dispatch('remove-request').status, 'confirm');
  assert.equal(m.dispatch('confirm', { yes: true }).status, 'saved');
  assert.equal(resources(m).length, 1);
});

test('owned credential blocks replacement/removal and whole-provider disable, not per-key disable', () => {
  const m = create('owned');
  assert.equal(m.dispatch('editor-open', { mode: 'replace' }).status, 'error');
  assert.equal(m.dispatch('remove-request').status, 'error');
  assert.equal(m.dispatch('provider-toggle').status, 'error');
  assert.equal(m.snapshot().providers.exa.enabled, true);
  assert.equal(m.dispatch('resource-toggle').status, 'saved');
  assert.equal(resources(m)[0].enabled, false);
});

test('environment-only SearXNG is not silently given a local enable switch', () => {
  const m = create('external'); m.dispatch('navigate', { page: 'sx' });
  const enabled = m.snapshot().providers.sx.enabled;
  assert.equal(m.dispatch('provider-toggle').status, 'error');
  assert.equal(m.snapshot().providers.sx.enabled, enabled);
});

test('order edits remain draft until one confirmation; cancel restores order', () => {
  const m = create(); const original = m.snapshot().order;
  m.dispatch('navigate', { page: 'order' }); m.dispatch('order-move', { delta: 1 });
  assert.deepEqual(m.snapshot().order, original);
  assert.notDeepEqual(m.snapshot().orderDraft, original);
  m.dispatch('order-cancel'); assert.deepEqual(m.snapshot().orderDraft, original);
  m.dispatch('order-add', { provider: 'sx' });
  assert.equal(m.dispatch('order-save').status, 'confirm');
  assert.deepEqual(m.snapshot().order, original);
  m.dispatch('confirm', { yes: true }); assert.equal(m.snapshot().order.at(-1), 'sx');
});

test('private URL requires narrow consent, URL changes clear permissions, add never enables provider', () => {
  const m = create(); m.dispatch('navigate', { page: 'sx' });
  m.dispatch('editor-open', { mode: 'add' });
  m.dispatch('editor-draft', { url: 'http://127.0.0.1:9999/' });
  assert.equal(m.dispatch('editor-save').status, 'error');
  m.dispatch('editor-draft', { permission: 'private', cidr: '127.0.0.1/32' });
  assert.equal(m.dispatch('editor-save').kind, 'private-network');
  assert.equal(m.dispatch('confirm', { yes: true }).status, 'saved');
  assert.equal(m.snapshot().providers.sx.enabled, false);
  m.dispatch('editor-open', { mode: 'replace' });
  m.dispatch('editor-draft', { url: 'https://changed.example/' });
  assert.equal(m.snapshot().dialog.draft.permission, 'public');
  assert.equal(m.snapshot().dialog.draft.cidr, '');
  m.dispatch('cancel');
});

test('save failure preserves draft for retry; partial write preserves orphan metadata, not a configured row', () => {
  const failed = create('error'); failed.dispatch('editor-open', { mode: 'add' });
  assert.equal(failed.dispatch('editor-save').code, 'save-failed');
  assert.equal(failed.snapshot().dialog.type, 'editor');
  assert.equal(failed.dispatch('editor-save').status, 'saved');
  const partial = create('partial-save'); partial.dispatch('editor-open', { mode: 'add' });
  assert.equal(partial.dispatch('editor-save').code, 'partial-save');
  assert.equal(resources(partial).length, 2);
  assert.equal(partial.snapshot().orphanCredentials[0].registered, false);
  partial.dispatch('cancel');
  assert.equal(partial.snapshot().orphanCredentials.length, 1);
});

test('simulated test is explicitly synthetic and reports zero network requests', () => {
  const m = create(); assert.equal(m.dispatch('test-request').status, 'confirm');
  const result = m.dispatch('confirm', { yes: true });
  assert.equal(result.status, 'simulated-success');
  assert.equal(result.synthetic, true); assert.equal(result.networkRequests, 0);
});

test('unsaved order draft survives navigation without silently replacing the edits', () => {
  const m = create(); m.dispatch('navigate', { page: 'order' });
  m.dispatch('order-move', { delta: 1 }); const draft = m.snapshot().orderDraft;
  m.dispatch('navigate', { page: 'exa' }); m.dispatch('navigate', { page: 'order' });
  assert.deepEqual(m.snapshot().orderDraft, draft);
});

test('environment-only SearXNG exposes one read-only endpoint, not editable key-like references', () => {
  const m = create('external'); m.dispatch('navigate', { page: 'sx' });
  assert.equal(m.snapshot().providers.sx.resources.length, 1);
  assert.equal(m.snapshot().providers.sx.enabled, true);
  assert.equal(m.dispatch('remove-request').status, 'error');
  assert.equal(m.dispatch('resource-toggle').status, 'error');
});

test('single SearXNG instance enable/disable is not advertised as an existing capability', () => {
  const m = create(); m.dispatch('navigate', { page: 'sx' });
  assert.equal(m.dispatch('resource-toggle').status, 'error');
  const html = fs.readFileSync(__dirname + '/prototype.html', 'utf8');
  assert.match(html, /p\s*!==\s*['"]sx['"]/);
});

test('local SearXNG configuration replaces effective environment endpoints, last removal restores fallback', () => {
  const m = create('external'); m.dispatch('navigate', { page: 'sx' });
  const fallback = m.snapshot().providers.sx.resources[0].ref;
  m.dispatch('editor-open', { mode: 'add' });
  assert.equal(m.dispatch('editor-save').status, 'saved');
  let provider = m.snapshot().providers.sx;
  assert.equal(provider.externallyManaged, false);
  assert.equal(provider.resources.length, 1); assert.equal(provider.resources[0].source, 'local');
  assert.notEqual(provider.resources[0].ref, fallback);
  assert.equal(m.dispatch('remove-request').status, 'confirm');
  assert.equal(m.dispatch('confirm', { yes: true }).status, 'saved');
  provider = m.snapshot().providers.sx;
  assert.equal(provider.externallyManaged, true);
  assert.equal(provider.resources.length, 1); assert.equal(provider.resources[0].ref, fallback);
});

test('instance URL validation rejects lexical input the real configuration rejects', () => {
  const m = create(); m.dispatch('navigate', { page: 'sx' });
  for (const url of [' https://bad.example/', 'https://bad.example/a b', 'https://bad.example/\\\\bad', 'https://bad.example/' + 'a'.repeat(4096)]) {
    m.dispatch('editor-open', { mode: 'add' }); m.dispatch('editor-draft', { url });
    assert.equal(m.dispatch('editor-save').status, 'error'); m.dispatch('cancel');
  }
});

test('editing an unchanged canonical URL does not lose its existing permission', () => {
  const m = create(); m.dispatch('navigate', { page: 'sx' });
  m.dispatch('editor-open', { mode: 'add' });
  m.dispatch('editor-draft', { url: 'http://127.0.0.1:9999/' });
  m.dispatch('editor-draft', { permission: 'private', cidr: '127.0.0.1/32' });
  m.dispatch('editor-save'); m.dispatch('confirm', { yes: true });
  const ref = m.snapshot().selected.sx;
  m.dispatch('editor-open', { mode: 'replace' });
  m.dispatch('editor-draft', { url: ref.replace(/\/+$/, '') + '/' });
  assert.equal(m.snapshot().dialog.draft.permission, 'private');
  assert.equal(m.snapshot().dialog.draft.cidr, '127.0.0.1/32');
  m.dispatch('cancel');
});

test('first local SearXNG configuration follows defaults without fabricating a toggle for missing config', () => {
  const m = create('empty'); m.dispatch('navigate', { page: 'sx' });
  assert.equal(m.dispatch('provider-toggle').status, 'error');
  m.dispatch('editor-open', { mode: 'add' });
  assert.equal(m.dispatch('editor-save').status, 'saved');
  assert.equal(m.snapshot().providers.sx.enabled, true);
  assert.equal(m.snapshot().order.includes('sx'), false);
});

test('standalone scripts parse and contain no network or browser persistence calls', () => {
  const html = fs.readFileSync(__dirname + '/prototype.html', 'utf8');
  const source = fs.readFileSync(__dirname + '/prototype-model.js', 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  new vm.Script(source);
  assert.doesNotMatch(html + source, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage)\s*(?:\(|\.)/);
  assert.match(html, /src="prototype-model\.js"/);
});
