'use strict';
// No repository dependencies. Supply an absolute temporary Playwright package path.
// PLAYWRIGHT_MODULE_PATH=/tmp/.../runtime/node_modules/playwright
// PLAYWRIGHT_BROWSERS_PATH=/tmp/.../browsers node .scratch/setup-tui-redesign/browser-check.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
if (!process.env.PLAYWRIGHT_MODULE_PATH || !process.env.PLAYWRIGHT_BROWSERS_PATH) throw Error('Temporary module and browser paths required');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
const { expect } = require(path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'test'));
const out = path.join(__dirname, 'browser-evidence');
fs.mkdirSync(path.join(out, 'screenshots'), { recursive: true });
const report = { started: new Date().toISOString(), playwright: require(path.join(process.env.PLAYWRIGHT_MODULE_PATH, 'package.json')).version, tests: [], screenshots: [], errors: [], networkAttempts: [], scope: 'Independent file:// prototype, synthetic data only; not PTY or service qualification' };
let browser, context;
const id = (p, s) => p.getByTestId(s);
const state = p => p.evaluate(() => window.prototypeState);
const focus = (p, s) => expect(id(p, s)).toBeFocused();
const closed = p => expect(id(p, 'modal')).not.toBeVisible();
async function scenario(p, s) { await id(p, 'scenario-picker').selectOption(s); await expect.poll(async () => (await state(p)).scenario).toBe(s); }
async function shot(p, name) {
  const geometry = await p.evaluate(() => {
    const box = el => { const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom, visible:getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0 }; };
    return { viewport:{width:innerWidth,height:innerHeight}, document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}, terminal:box(document.querySelector('.terminal')), workColumns:getComputedStyle(document.querySelector('.work')).gridTemplateColumns, modal:document.querySelector('dialog').open ? box(document.querySelector('dialog')) : null, controls:[...document.querySelectorAll('dialog[open] button')].map(el=>({id:el.id,...box(el)})) };
  });
  await p.screenshot({ path:path.join(out,'screenshots',name+'.png'), fullPage:true, timeout:5000 });
  report.screenshots.push({ name, geometry });
  return geometry;
}
async function test(name, fn) {
  const p = await context.newPage();
  p.setDefaultTimeout(2200); p.setDefaultNavigationTimeout(6000);
  p.on('pageerror', e => report.errors.push({ test:name,type:'pageerror',message:e.message }));
  p.on('console', m => { if (m.type()==='error') report.errors.push({test:name,type:'consoleerror',message:m.text()}); });
  try { await p.goto(pathToFileURL(path.join(__dirname,'prototype.html')).href); await expect(id(p,'resource-list')).toBeVisible(); await fn(p); report.tests.push({name,status:'passed'}); }
  catch(e) { report.tests.push({name,status:'failed',error:e.message}); try { await shot(p,'failure-'+name); } catch {} }
  finally { await p.close(); fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n'); }
}
(async()=>{
 try {
  browser = await chromium.launch({headless:true,timeout:20000}); report.chromium=browser.version();
  context = await browser.newContext({viewport:{width:1200,height:800},serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*', async route => {
   const url = route.request().url();
   if (/^(file:|data:)/.test(url)) return route.continue();
   report.networkAttempts.push({url,method:route.request().method()}); await route.abort('blockedbyclient');
  });
  await test('normal-global-language',async p=>{
   await expect(id(p,'sidebar').locator('[data-testid="nav-language"]')).toHaveCount(1);
   await expect(id(p,'content').locator('[data-testid*="language"]')).toHaveCount(0);
   await expect(id(p,'resource-list').locator('button[data-ref]')).toHaveCount(2); await shot(p,'normal-1200x800');
  });
  await test('empty-no-fake-row',async p=>{await scenario(p,'empty'); await expect(id(p,'resource-list').locator('button[data-ref]')).toHaveCount(0); await expect(id(p,'empty-add')).toBeVisible(); await shot(p,'empty');});
  await test('empty-entry-focus',async p=>{await scenario(p,'empty'); await id(p,'nav-tavily').click(); await id(p,'nav-exa').click(); await focus(p,'empty-add');});
  await test('add-save-select-new',async p=>{await id(p,'resource-add').click(); await focus(p,'dummy-key'); await shot(p,'add-dialog'); await id(p,'modal-save').click(); await closed(p); await expect(p.locator('[data-ref="EXA_API_KEY_3"]')).toHaveAttribute('aria-selected','true'); await focus(p,'resource-exa-3');});
  await test('escape-restores-trigger',async p=>{await id(p,'resource-add').click(); await p.keyboard.press('Escape'); await closed(p); await focus(p,'resource-add'); assert.equal((await state(p)).providers.exa.resources.length,2);});
  await test('environment-replace-blocked',async p=>{await scenario(p,'external'); await expect(id(p,'resource-replace')).toHaveAttribute('aria-disabled','true'); await id(p,'resource-replace').click(); await closed(p); await expect(id(p,'status')).toContainText('环境'); assert.equal((await state(p)).providers.exa.resources.length,2);});
  await test('external-provider-readonly',async p=>{await scenario(p,'external'); await id(p,'nav-sx').click(); await id(p,'provider-toggle').click(); await expect(id(p,'provider-toggle')).toHaveAttribute('aria-disabled','true'); assert.equal((await state(p)).providers.sx.enabled,false); await closed(p);});
  await test('external-sx-url-entirely-readonly',async p=>{await scenario(p,'external'); await id(p,'nav-sx').click(); const before=(await state(p)).providers.sx.resources; await id(p,'resource-remove').click(); if(await id(p,'modal').isVisible()){await shot(p,'external-sx-remove-confirm');await p.keyboard.press('y');} await shot(p,'external-sx-after-remove');assert.deepEqual((await state(p)).providers.sx.resources,before,'Environment-only SearXNG URL was removed as though it were a locally registered reference');});
  await test('environment-key-unlink-valid',async p=>{await scenario(p,'external');await id(p,'resource-remove').click();await expect(id(p,'modal')).toContainText('环境');await p.keyboard.press('y');await closed(p);assert.equal((await state(p)).providers.exa.resources.length,1);});
  await test('owned-guards-and-key-disable',async p=>{await scenario(p,'owned'); for(const s of ['resource-replace','resource-remove','provider-toggle']) {await expect(id(p,s)).toHaveAttribute('aria-disabled','true'); await id(p,s).click(); await closed(p);} await id(p,'resource-toggle').click(); const s=await state(p); assert.equal(s.providers.exa.enabled,true); assert.equal(s.providers.exa.resources[0].enabled,false); assert.equal(s.providers.exa.resources.length,2);});
  await test('shared-unlink-allowed',async p=>{await scenario(p,'owned'); await id(p,'resource-exa-2').click(); await expect(id(p,'resource-replace')).toHaveAttribute('aria-disabled','true'); await id(p,'resource-remove').click(); await p.keyboard.press('y'); await closed(p); const s=await state(p); assert.equal(s.providers.exa.resources.length,1); assert.equal(s.providers.exa.resources[0].source,'owned');});
  for (const key of ['Enter','n','Escape']) await test('confirm-cancel-'+key.toLowerCase(),async p=>{await id(p,'resource-remove').click(); await focus(p,'confirm-no'); if(key==='Enter')await shot(p,'yn-dialog'); await p.keyboard.press(key); await closed(p); assert.equal((await state(p)).providers.exa.resources.length,2); await focus(p,'resource-remove');});
  await test('confirm-focused-yes-enter',async p=>{await id(p,'resource-remove').click(); await id(p,'confirm-yes').focus(); await p.keyboard.press('Enter'); await closed(p); assert.equal((await state(p)).providers.exa.resources.length,1);});
  await test('confirm-y-accepts',async p=>{await id(p,'resource-remove').click(); await p.keyboard.press('y'); await closed(p); const s=await state(p); assert.equal(s.selected.exa,'EXA_API_KEY_2'); await expect(p.locator('[data-ref="EXA_API_KEY_2"]')).toHaveAttribute('aria-selected','true');});
  await test('textbox-y-not-confirmation',async p=>{await id(p,'nav-sx').click(); await id(p,'resource-add').click(); await id(p,'instance-url').fill(''); await p.keyboard.type('y'); await expect(id(p,'instance-url')).toHaveValue('y'); await expect(id(p,'modal')).toBeVisible(); assert.equal((await state(p)).providers.sx.resources.length,2); assert.equal((await state(p)).dialog.draft.url,'y');});
  await test('modal-tab-shift-trap',async p=>{await id(p,'resource-add').click(); await p.keyboard.press('Shift+Tab'); await focus(p,'modal-save'); await p.keyboard.press('Tab'); await focus(p,'dummy-key'); for(let i=0;i<9;i++){await p.keyboard.press('Tab');assert.ok(await p.evaluate(()=>document.activeElement.closest('dialog')!==null));} await p.keyboard.press('Escape'); await id(p,'resource-remove').click(); await p.keyboard.press('Shift+Tab'); await focus(p,'confirm-yes'); await p.keyboard.press('Tab'); await focus(p,'confirm-no');});
  await test('regions-tab-shift',async p=>{await id(p,'nav-exa').focus(); for(const target of ['provider-toggle','resource-exa-1','resource-add','nav-exa']){await p.keyboard.press('Tab');await focus(p,target);} await p.keyboard.press('Shift+Tab');await focus(p,'resource-add');});
  await test('many12-paging-stable-ref',async p=>{await scenario(p,'many12'); await id(p,'resource-exa-1').click(); await p.keyboard.press('PageDown'); await expect(p.locator('[data-ref="EXA_API_KEY_7"]')).toHaveAttribute('aria-selected','true'); await p.keyboard.press('End'); await focus(p,'resource-exa-12'); assert.equal((await state(p)).selected.exa,'EXA_API_KEY_12'); await p.keyboard.press('Home'); assert.equal((await state(p)).selected.exa,'EXA_API_KEY'); await p.keyboard.press('End'); await id(p,'resource-add').click(); await p.keyboard.press('Escape'); assert.equal((await state(p)).selected.exa,'EXA_API_KEY_12'); await shot(p,'many12-end');});
  await test('order-draft-cancel-save',async p=>{await id(p,'nav-order').click(); await id(p,'order-down').click(); let s=await state(p); assert.deepEqual(s.order,['exa','tavily','firecrawl']); assert.deepEqual(s.orderDraft,['tavily','exa','firecrawl']); await id(p,'order-cancel').click(); assert.deepEqual((await state(p)).orderDraft,['exa','tavily','firecrawl']); await id(p,'order-down').click(); await id(p,'order-save').click(); await p.keyboard.press('Enter'); assert.deepEqual((await state(p)).order,['exa','tavily','firecrawl']); await id(p,'order-save').click(); await p.keyboard.press('y'); assert.deepEqual((await state(p)).order,['tavily','exa','firecrawl']);});
  await test('dirty-order-sidebar-return',async p=>{await id(p,'nav-order').click(); await id(p,'order-down').click(); const draft=(await state(p)).orderDraft; await id(p,'nav-tavily').click(); await closed(p); await id(p,'nav-order').click(); const actual=(await state(p)).orderDraft; await shot(p,'dirty-order-return'); assert.deepEqual(actual,draft,'Dirty order draft silently discarded after sidebar navigation without discard confirmation');});
  await test('sx-invalid-inline-focus',async p=>{await id(p,'nav-sx').click(); await id(p,'resource-add').click(); await id(p,'instance-url').fill('not a URL'); await id(p,'modal-save').click(); await expect(id(p,'modal-error')).toBeVisible(); await focus(p,'instance-url'); await shot(p,'invalid-url'); assert.equal((await state(p)).providers.sx.resources.length,2);});
  await test('sx-url-permissions-reset',async p=>{await id(p,'nav-sx').click(); await id(p,'resource-add').click(); await id(p,'instance-url').fill('http://127.0.0.1:8888/'); await id(p,'network-permission').selectOption('private'); await id(p,'network-cidr').fill('127.0.0.1/32'); await id(p,'instance-url').fill('https://new-search.example/'); await expect(id(p,'network-permission')).toHaveValue('public'); await expect(id(p,'network-cidr')).toHaveValue(''); let s=await state(p); assert.equal(s.dialog.draft.permission,'public'); assert.equal(s.dialog.draft.cidr,''); await id(p,'modal-save').click(); await closed(p); assert.equal((await state(p)).providers.sx.resources.at(-1).cidr,'');});
  await test('sx-private-consent-default-no-and-y',async p=>{await id(p,'nav-sx').click(); for(const key of ['Enter','y']){await id(p,'resource-add').click(); await id(p,'instance-url').fill('http://127.0.0.1:8888/'); await id(p,'network-permission').selectOption('private'); await id(p,'network-cidr').fill('127.0.0.1/32'); await id(p,'modal-save').click(); await focus(p,'editor-confirm-no'); await p.keyboard.press(key); await closed(p);} const s=await state(p); assert.equal(s.providers.sx.resources.length,3); assert.equal(s.providers.sx.resources.at(-1).cidr,'127.0.0.1/32');});
  await test('error-retains-draft-retry',async p=>{await scenario(p,'error'); await id(p,'resource-add').click(); await id(p,'dummy-key').selectOption('synthetic-beta'); await id(p,'modal-save').click(); await expect(id(p,'modal-error')).toBeVisible(); await focus(p,'dummy-key'); await expect(id(p,'dummy-key')).toHaveValue('synthetic-beta'); await shot(p,'save-error'); await id(p,'modal-save').click(); await closed(p); assert.equal((await state(p)).providers.exa.resources.length,3);});
  await test('partial-save-orphan-no-row',async p=>{await scenario(p,'partial-save'); await id(p,'resource-add').click(); await id(p,'modal-save').click(); await expect(id(p,'modal-error')).toContainText('未回滚'); await focus(p,'dummy-key'); await shot(p,'partial-error'); let s=await state(p); assert.equal(s.orphanCredentials.length,1); assert.equal(s.providers.exa.resources.length,2); await expect(p.locator('[data-ref="EXA_API_KEY_3"]')).toHaveCount(0); await p.keyboard.press('Escape'); s=await state(p); assert.equal(s.orphanCredentials[0].registered,false); await expect(id(p,'status')).toContainText('未回滚');});
  await test('locale-focus-retained',async p=>{await id(p,'resource-exa-2').click(); await id(p,'nav-language').click(); await id(p,'language-en').click(); await focus(p,'language-en'); await expect(id(p,'nav-language')).toHaveText('Language'); await id(p,'nav-exa').click(); await expect(p.locator('[data-ref="EXA_API_KEY_2"]')).toHaveAttribute('aria-selected','true'); await id(p,'resource-remove').click(); await expect(id(p,'modal')).toContainText('[y/N]'); await shot(p,'english-confirm');});
  await test('fake-connection-zero-http',async p=>{await id(p,'test-connection').click(); await p.keyboard.press('y'); await closed(p); await expect(id(p,'status')).toContainText('未联网'); assert.equal((await state(p)).lastResult.networkRequests,0);});
  await test('compact-single-column-geometry',async p=>{await p.setViewportSize({width:600,height:480}); const g=await shot(p,'compact-600x480'); assert.equal(g.workColumns.trim().split(/\s+/).length,1,'Spec proposes single-column compact layout; actual grid '+g.workColumns);});
  await test('resize-dialog-draft-and-geometry',async p=>{await id(p,'nav-sx').click(); await id(p,'resource-add').click(); await id(p,'instance-url').fill('https://resize.example/'); await p.setViewportSize({width:600,height:480}); await focus(p,'instance-url'); await expect(id(p,'instance-url')).toHaveValue('https://resize.example/'); const g=await shot(p,'compact-dialog'); assert.ok(g.modal.x>=0 && g.modal.y>=0 && g.modal.right<=600 && g.modal.bottom<=480); for(const c of g.controls)assert.ok(c.right<=600&&c.bottom<=480,'Dialog control outside viewport: '+c.id);});
  await test('tiny-guard-blocks-mouse-keyboard',async p=>{await id(p,'resource-remove').click(); await p.setViewportSize({width:320,height:240}); await expect(id(p,'small-viewport')).toBeVisible(); await shot(p,'tiny-guard'); await expect(id(p,'modal')).not.toBeVisible(); await p.keyboard.press('y'); assert.equal((await state(p)).providers.exa.resources.length,2); let blocked=false; try {await id(p,'confirm-yes').click({trial:true,timeout:500});}catch{blocked=true;} assert.ok(blocked,'Dangerous confirmation clickable'); await p.keyboard.press('Escape'); await p.setViewportSize({width:1200,height:800}); await closed(p); assert.equal((await state(p)).providers.exa.resources.length,2);});
  await test('tiny-modal-tab-focus-guard',async p=>{await id(p,'resource-remove').click(); await p.setViewportSize({width:320,height:240}); await p.keyboard.press('Tab'); const focused=await p.evaluate(()=>({id:document.activeElement.id,hidden:getComputedStyle(document.activeElement).visibility==='hidden',modal:!!document.activeElement.closest('dialog')})); await shot(p,'tiny-modal-tab'); await p.keyboard.press('Enter'); assert.equal((await state(p)).providers.exa.resources.length,2); assert.ok(!focused.hidden&&!focused.modal,'Tiny guard leaves keyboard focus in hidden modal: '+JSON.stringify(focused));});
  await test('tiny-workspace-blocks-danger',async p=>{await p.setViewportSize({width:320,height:240}); let blocked=false;try{await id(p,'resource-remove').click({trial:true,timeout:500});}catch{blocked=true;}assert.ok(blocked);await id(p,'nav-exa').focus();await p.keyboard.press('Enter');await p.keyboard.press('d');assert.equal((await state(p)).dialog,null);await shot(p,'tiny-workspace');});
 } catch(e) { report.blocker=e.stack; }
 finally {
  if(context)await context.close().catch(e=>report.errors.push({type:'cleanup',message:e.message}));
  if(browser){await browser.close().catch(e=>report.errors.push({type:'cleanup',message:e.message}));report.browserCloseCalled=true;}
  report.finished=new Date().toISOString(); report.summary={passed:report.tests.filter(x=>x.status==='passed').length,failed:report.tests.filter(x=>x.status==='failed').length,pageConsoleErrors:report.errors.length,networkAttempts:report.networkAttempts.length};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({versions:{playwright:report.playwright,chromium:report.chromium},...report.summary,blocker:report.blocker,failedTests:report.tests.filter(x=>x.status==='failed').map(x=>({name:x.name,error:x.error.slice(0,700)})),browserCloseCalled:report.browserCloseCalled},null,2));
  if(report.blocker||report.summary.failed||report.errors.length||report.networkAttempts.length)process.exitCode=1;
 }
})();
