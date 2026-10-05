/* Synthetic design prototype only. No I/O, credentials, persistence or network. */
(function (root) {
  'use strict';
  const providers = ['exa', 'tavily', 'firecrawl', 'sx'];
  const copy = value => structuredClone(value);
  function canonicalURL(value) {
    if (value.length > 4096 || /[\\\\\u0000-\u0020\u007f]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
      return url.href.replace(/\/+$/, '');
    } catch { return null; }
  }
  function fixture(provider, index, source = 'local') {
    return provider === 'sx'
      ? { ref: index === 1 ? 'https://search.example' : `https://search${index}.example`, kind: 'instance', source, permission: 'public', cidr: '' }
      : { ref: `${provider.toUpperCase()}_API_KEY${index === 1 ? '' : '_' + index}`, source, enabled: true };
  }
  function guard(resource, action) {
    if (!resource) return 'no-resource';
    if (resource.source === 'owned') return 'ownership';
    if (resource.source === 'shared' && action === 'replace') return 'shared';
    if (resource.source === 'environment' && (action === 'replace' || resource.kind === 'instance')) return resource.kind === 'instance' ? 'externally-managed' : 'environment';
    return '';
  }
  function narrowCIDR(value) {
    const parts = value.split('/');
    if (parts.length !== 2) return false;
    const [ip, prefix] = parts;
    if (prefix === '32') {
      const octets = ip.split('.');
      return octets.length === 4 && octets.every(x => /^\d{1,3}$/.test(x) && Number(x) <= 255) &&
        (octets[0] === '10' || (octets[0] === '192' && octets[1] === '168') ||
        (octets[0] === '172' && Number(octets[1]) >= 16 && Number(octets[1]) <= 31) || octets[0] === '127');
    }
    if (prefix === '128' && (/^f[cd][0-9a-f]{2}:/i.test(ip) || ip === '::1')) {
      try { return Boolean(new URL('http://[' + ip + ']/').hostname); } catch { return false; }
    }
    return false;
  }
  function createPrototypeModel(initialScenario = 'normal') {
    let state;
    function reset(scenario) {
      const aliases = { Empty: 'empty', Normal: 'normal', Many12: 'many12', External: 'external', Owned: 'owned', Error: 'error', 'Partial-save': 'partial-save' };
      scenario = aliases[scenario] || String(scenario).toLowerCase();
      if (!['empty', 'normal', 'many12', 'external', 'owned', 'error', 'partial-save'].includes(scenario)) throw new Error('Unknown prototype scenario');
      state = { scenario, lang: state?.lang || 'zh', page: 'exa', providers: {}, selected: {}, order: ['exa', 'tavily', 'firecrawl'], orderDraft: null, orderSelected: 'exa', failures: 0, partialCredentialSaved: false, orphanCredentials: [], dialog: null, lastResult: null };
      for (const p of providers) {
        const count = scenario === 'empty' ? 0 : scenario === 'many12' ? 12 : 2;
        state.providers[p] = { enabled: p !== 'sx', resources: Array.from({ length: count }, (_, i) => fixture(p, i + 1)) };
        if (scenario === 'external' && count) {
          state.providers[p].resources[0].source = 'environment';
          if (p === 'sx') {
            state.providers[p].externallyManaged = true;
            state.providers[p].enabled = true;
            state.providers[p].resources = [fixture(p, 1, 'environment')];
            // Separate fallback metadata; never pool environment and local instances.
            state.providers[p].environmentFallback = copy(state.providers[p].resources);
          }
        }
        if (scenario === 'owned' && count && p !== 'sx') {
          state.providers[p].resources[0].source = 'owned';
          state.providers[p].resources[1].source = 'shared';
        }
        state.selected[p] = state.providers[p].resources[0]?.ref || null;
      }
    }
    const selected = (p = state.page) => state.providers[p]?.resources.find(r => r.ref === state.selected[p]);
    function result(status, extra = {}) { const output = { status, ...extra }; state.lastResult = output; return copy(output); }
    function error(code) { if (state.dialog) state.dialog.error = code; return result('error', { code }); }
    function editorResource() {
      const d = state.dialog, p = d.provider;
      if (p !== 'sx') {
        let index = 1;
        while (state.providers[p].resources.some(r => r.ref === fixture(p, index).ref)) index++;
        return d.original ? copy(d.original) : fixture(p, index);
      }
      const identity = canonicalURL(d.draft.url);
      if (identity === null) return { error: 'url' };
      let url;
      try { url = new URL(identity); }
      catch { return { error: 'url' }; }
      const host = url.hostname.replace(/^\[|\]$/g, '');
      const privateHost = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:)/i.test(host) || /\.(local|internal|localhost)$/i.test(host) || (!host.includes('.') && !host.includes(':'));
      const { permission } = d.draft, cidr = d.draft.cidr.trim();
      if (privateHost && permission === 'public') return { error: 'permission' };
      if (permission === 'private' && !narrowCIDR(cidr)) return { error: 'cidr' };
      if (permission === 'private' && /^\d+\.\d+\.\d+\.\d+$/.test(host) && cidr !== host + '/32') return { error: 'cidr-match' };
      if (permission === 'private' && host.includes(':')) {
        try { if (new URL('http://[' + cidr.split('/')[0] + ']/').hostname !== url.hostname) return { error: 'cidr-match' }; }
        catch { return { error: 'cidr-match' }; }
      }
      return { ref: identity, kind: 'instance', source: 'local', permission, cidr: permission === 'private' ? cidr : '' };
    }
    function saveEditor() {
      const d = state.dialog;
      if (!d || d.type !== 'editor') return error('no-editor');
      if (d.pending) return result('confirm', { kind: d.pending });
      const resource = editorResource();
      if (resource.error) return error(resource.error);
      if (resource.permission === 'private' && !d.permissionConfirmed) { d.pending = 'private-network'; return result('confirm', { kind: d.pending, resource }); }
      if (d.original && !d.replaceConfirmed) { d.pending = 'replace'; return result('confirm', { kind: d.pending, target: d.target }); }
      const provider = state.providers[d.provider];
      const overridesEnvironment = d.provider === 'sx' && provider.externallyManaged && !d.original;
      const list = overridesEnvironment ? [] : provider.resources;
      const index = list.findIndex(r => r.ref === d.target);
      if (d.original && index < 0) return error('stale-target');
      if (d.original && guard(list[index], 'replace')) return error(guard(list[index], 'replace'));
      if (list.some(r => r.ref === resource.ref && r.ref !== d.target)) return error('duplicate');
      if (['error', 'partial-save'].includes(state.scenario) && state.failures === 0) {
        state.failures++;
        if (state.scenario === 'partial-save' && d.provider !== 'sx') {
          state.partialCredentialSaved = true;
          state.orphanCredentials.push({ ref: resource.ref, provider: d.provider, synthetic: true, credentialSaved: true, registered: false });
        }
        return error(state.scenario === 'partial-save' && d.provider !== 'sx' ? 'partial-save' : 'save-failed');
      }
      if (d.provider === 'sx') {
        if (overridesEnvironment || !provider.resources.length) provider.enabled = true;
        provider.externallyManaged = false;
        provider.resources = list;
      }
      if (d.original) list[index] = resource; else list.push(resource);
      state.selected[d.provider] = resource.ref;
      state.orphanCredentials = state.orphanCredentials.filter(orphan => !(orphan.provider === d.provider && orphan.ref === resource.ref));
      state.partialCredentialSaved = state.orphanCredentials.length > 0;
      state.dialog = null;
      return result('saved', { ref: resource.ref });
    }
    function dispatch(action, payload = {}) {
      if (state.dialog && !['scenario', 'editor-draft', 'editor-save', 'confirm', 'cancel'].includes(action)) return error('dialog-open');
      switch (action) {
        case 'scenario': reset(payload.scenario); return result('ready');
        case 'navigate':
          if (!providers.includes(payload.page) && !['order', 'language'].includes(payload.page)) return error('page');
          if (state.dialog) return error('dialog-open');
          state.page = payload.page;
          if (state.page === 'order') {
            if (state.orderDraft === null) state.orderDraft = [...state.order];
            if (!state.orderDraft.includes(state.orderSelected)) state.orderSelected = state.orderDraft[0];
          }
          return result('ready');
        case 'language':
          if (!['zh', 'en'].includes(payload.lang)) return error('language');
          state.lang = payload.lang; return result('saved');
        case 'select': {
          const p = payload.provider || state.page;
          if (!state.providers[p]?.resources.some(r => r.ref === payload.ref)) return error('no-resource');
          state.selected[p] = payload.ref; return result('selected', { ref: payload.ref });
        }
        case 'provider-toggle': {
          const provider = state.providers[state.page];
          if (!provider) return error('page');
          if (provider.externallyManaged) return error('externally-managed');
          if (state.page === 'sx' && !provider.resources.length) return error('no-local-instance');
          if (provider.enabled && provider.resources.some(r => r.source === 'owned')) return error('ownership');
          provider.enabled = !provider.enabled; return result('saved');
        }
        case 'resource-toggle': {
          if (state.page === 'sx') return error('instance-toggle-unavailable');
          const r = selected(); if (!r) return error('no-resource'); r.enabled = !r.enabled; return result('saved');
        }
        case 'editor-open': {
          if (state.dialog) return error('dialog-open');
          const p = state.page, mode = payload.mode;
          if (!providers.includes(p) || !['add', 'replace'].includes(mode)) return error('editor-mode');
          const r = mode === 'replace' ? selected() : null;
          if (mode === 'replace' && guard(r, 'replace')) return error(guard(r, 'replace'));
          state.dialog = { type: 'editor', provider: p, mode, original: r ? copy(r) : null, target: r?.ref || null, draft: p === 'sx' ? { url: r?.ref || 'https://search-new.example/', permission: r?.permission || 'public', cidr: r?.cidr || '' } : { dummy: 'synthetic-alpha' }, permissionConfirmed: false, replaceConfirmed: false, pending: null, error: null };
          return result('opened');
        }
        case 'editor-draft': {
          const d = state.dialog;
          if (!d || d.type !== 'editor') return error('no-editor');
          if (d.pending) return error('confirmation-pending');
          for (const key of Object.keys(payload)) {
            if (!Object.hasOwn(d.draft, key) || typeof payload[key] !== 'string') return error('draft-field');
            if (key === 'dummy' && !['synthetic-alpha', 'synthetic-beta'].includes(payload[key])) return error('dummy-only');
            if (key === 'permission' && !['public', 'private'].includes(payload[key])) return error('permission');
          }
          if (Object.hasOwn(payload, 'url') && payload.url !== d.draft.url) {
            const nextIdentity = canonicalURL(payload.url);
            if (nextIdentity === null || nextIdentity !== canonicalURL(d.draft.url)) {
              d.draft.permission = 'public'; d.draft.cidr = ''; d.permissionConfirmed = false;
            }
          }
          // URL updates deliberately cannot carry endpoint permission in the same action.
          for (const [key, value] of Object.entries(payload)) if (!(Object.hasOwn(payload, 'url') && ['permission', 'cidr'].includes(key))) d.draft[key] = value;
          if (Object.hasOwn(payload, 'permission') || Object.hasOwn(payload, 'cidr')) d.permissionConfirmed = false;
          if (!['public', 'private'].includes(d.draft.permission) && d.provider === 'sx') return error('permission');
          d.replaceConfirmed = false;
          return result('draft');
        }
        case 'editor-save': return saveEditor();
        case 'remove-request': {
          const r = selected(), code = guard(r, 'remove');
          if (code) return error(code);
          state.dialog = { type: 'confirm', kind: 'remove', provider: state.page, target: r.ref, source: r.source };
          return result('confirm', { kind: 'remove', target: r.ref, source: r.source });
        }
        case 'test-request': {
          const p = state.page, provider = state.providers[p];
          if (!provider?.enabled || !(p === 'sx' ? provider.resources.length : provider.resources.some(r => r.enabled))) return error('test-unavailable');
          state.dialog = { type: 'confirm', kind: 'test', provider: p }; return result('confirm', { kind: 'test' });
        }
        case 'confirm': {
          const d = state.dialog;
          if (!d) return error('no-confirmation');
          if (payload.yes !== true) { state.dialog = null; return result('canceled'); }
          if (d.type === 'editor') {
            if (d.pending === 'private-network') d.permissionConfirmed = true;
            else if (d.pending === 'replace') d.replaceConfirmed = true;
            else return error('no-confirmation');
            d.pending = null; return saveEditor();
          }
          if (d.kind === 'remove') {
            const list = state.providers[d.provider].resources, index = list.findIndex(r => r.ref === d.target);
            if (index < 0) return error('stale-target');
            if (guard(list[index], 'remove')) return error(guard(list[index], 'remove'));
            if (d.provider === 'sx' && list.length === 1) {
              const order = state.order.filter(p => p !== 'sx');
              if (!order.length) return error('order-minimum');
              const provider = state.providers.sx;
              state.order = order;
              if (state.orderDraft !== null) {
                state.orderDraft = state.orderDraft.filter(p => p !== 'sx');
                if (!state.orderDraft.includes(state.orderSelected)) state.orderSelected = state.orderDraft[0] || null;
              }
              provider.resources = copy(provider.environmentFallback || []);
              provider.externallyManaged = provider.resources.length > 0;
              provider.enabled = provider.externallyManaged;
              state.selected.sx = provider.resources[0]?.ref || null;
            } else {
              list.splice(index, 1); state.selected[d.provider] = list[Math.min(index, list.length - 1)]?.ref || null;
            }
          } else if (d.kind === 'order-save') { state.order = [...d.next]; state.orderDraft = [...d.next]; }
          else if (d.kind !== 'test') return error('no-confirmation');
          state.dialog = null;
          return result(d.kind === 'test' ? 'simulated-success' : 'saved', { synthetic: true, networkRequests: 0 });
        }
        case 'cancel': state.dialog = null; return result('canceled');
        case 'order-select':
          if (!state.orderDraft?.includes(payload.provider)) return error('order-provider');
          state.orderSelected = payload.provider; return result('selected');
        case 'order-move': {
          const draft = state.orderDraft, index = draft?.indexOf(state.orderSelected), next = index + payload.delta;
          if (![-1, 1].includes(payload.delta) || index < 0 || next < 0 || next >= draft.length) return result('unchanged');
          [draft[index], draft[next]] = [draft[next], draft[index]]; return result('draft');
        }
        case 'order-remove': {
          const draft = state.orderDraft;
          if (!draft || draft.length <= 1) return error('order-minimum');
          const index = draft.indexOf(state.orderSelected); if (index < 0) return error('order-provider');
          draft.splice(index, 1); state.orderSelected = draft[Math.min(index, draft.length - 1)]; return result('draft');
        }
        case 'order-add':
          if (!state.orderDraft || !providers.includes(payload.provider) || state.orderDraft.includes(payload.provider)) return error('order-provider');
          state.orderDraft.push(payload.provider); state.orderSelected = payload.provider; return result('draft');
        case 'order-cancel': state.orderDraft = [...state.order]; state.orderSelected = state.orderDraft[0]; return result('canceled');
        case 'order-save':
          if (!state.orderDraft?.length) return error('order-minimum');
          state.dialog = { type: 'confirm', kind: 'order-save', previous: [...state.order], next: [...state.orderDraft], privacyChanged: state.order.indexOf('sx') !== state.orderDraft.indexOf('sx') };
          return result('confirm', { kind: 'order-save', ...copy(state.dialog) });
        default: throw new Error('Unknown prototype action: ' + action);
      }
    }
    reset(initialScenario);
    return Object.freeze({ snapshot: () => copy(state), dispatch });
  }
  const api = Object.freeze({ createPrototypeModel, guard, narrowCIDR });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArkSetupPrototype = api;
})(globalThis);
