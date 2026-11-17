// PyTerm single sign-on (main thread): Google Identity Services and Microsoft MSAL.
//
// Python asks for tokens through the page bridge (pyterm.sso → 'sso.*' requests). Sign-in
// pop-ups must be opened by a click, so interactive steps go through ui.interact(), which
// shows a dialog whose "Continue" button calls start() synchronously.
//
// Tokens:
//   Google     token model (no refresh token in the browser). A cached token is reused while
//              it is valid; renewing needs the pop-up again, so with keep_alive a notice with a
//              "Renew" button appears 5 minutes before expiry.
//   Microsoft  MSAL with refresh tokens: acquireTokenSilent() renews silently. With keep_alive
//              tokens are refreshed 5 minutes before expiry; a notice appears only if Microsoft
//              requires the user again (expired session, new consent).

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const MSAL_SRC = 'https://cdn.jsdelivr.net/npm/@azure/msal-browser@4.30.0/+esm';
const GOOGLE_BASE = ['openid', 'email', 'profile'];
const GOOGLE_ALIAS = {
  email: 'https://www.googleapis.com/auth/userinfo.email',
  profile: 'https://www.googleapis.com/auth/userinfo.profile',
};
const RENEW_BEFORE = 300; // seconds
const now = () => Date.now() / 1000;
const uniq = (a) => [...new Set(a.filter(Boolean))];

export class SSOError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new SSOError('network', `Could not load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * ui = {
 *   interact({provider, scopes, mode, signal}, start) → Promise   (dialog; start() inside the click)
 *   notice(provider, text, actionLabel, onAction)                 (non-blocking renew notice)
 *   clearNotice(provider)
 * }
 */
export function createSSO({ ui, configUrl = 'sso.json' }) {
  let fileCfg = null;
  const overrides = { google: {}, microsoft: {} };

  async function conf(p) {
    if (!fileCfg) {
      try {
        const r = await fetch(configUrl, { cache: 'no-cache' });
        fileCfg = r.ok ? await r.json() : {};
      } catch { fileCfg = {}; }
    }
    return { ...((fileCfg && fileCfg[p]) || {}), ...overrides[p] };
  }

  /* ------------------------------------------------------------ Google */
  const G = { token: null, keepAlive: true, timer: 0, gis: null, hint: null };

  function gis() {
    if (!G.gis) {
      G.gis = (async () => {
        const ok = () => window.google && window.google.accounts && window.google.accounts.oauth2;
        if (!ok()) await loadScript(GIS_SRC);
        for (let i = 0; i < 50 && !ok(); i++) await new Promise((r) => setTimeout(r, 100));
        if (!ok()) throw new SSOError('network', 'Google Identity Services did not load');
        return window.google.accounts.oauth2;
      })().catch((e) => { G.gis = null; throw e; });
    }
    return G.gis;
  }

  function gErr(type, desc) {
    const map = {
      popup_failed_to_open: 'popup_blocked', popup_closed: 'cancelled', access_denied: 'consent_denied',
      interaction_required: 'interaction_required', consent_required: 'interaction_required',
      login_required: 'interaction_required',
    };
    return new SSOError(map[type] || 'error', desc || type || 'Google sign-in failed');
  }

  function gCovers(granted, scopes) {
    const g = new Set(granted || []);
    return (scopes || []).every((s) => g.has(s) || (GOOGLE_ALIAS[s] && g.has(GOOGLE_ALIAS[s])));
  }

  async function googlePrep(scopes, { prompt, login_hint } = {}) {
    const c = await conf('google');
    if (!c.client_id) {
      throw new SSOError('not_configured',
        'Google sign-in is not set up. Add a "google" client_id to sso.json or call sso.configure("google", client_id=...).');
    }
    const oauth2 = await gis();
    const want = uniq([...GOOGLE_BASE, ...(c.scopes || []), ...(scopes || [])]);
    let pending = null;
    const hint = login_hint || G.hint || undefined;
    const client = oauth2.initTokenClient({
      client_id: c.client_id,
      scope: want.join(' '),
      include_granted_scopes: true,
      prompt: prompt == null ? '' : prompt,
      hint,
      login_hint: hint,
      callback: (resp) => {
        const p = pending; pending = null;
        if (!p) return;
        if (resp && resp.error) p.reject(gErr(resp.error, resp.error_description));
        else p.resolve(resp);
      },
      error_callback: (e) => {
        const p = pending; pending = null;
        if (p) p.reject(gErr(e && e.type, e && e.message));
      },
    });
    // start() must run inside a click: requestAccessToken() opens the pop-up synchronously
    return {
      start: () => new Promise((resolve, reject) => {
        pending = { resolve, reject };
        client.requestAccessToken();
      }).then((resp) => googleSave(resp)),
    };
  }

  async function googleSave(resp) {
    const t = {
      provider: 'google',
      access_token: resp.access_token,
      token_type: resp.token_type || 'Bearer',
      expires_at: now() + Number(resp.expires_in || 3600),
      scopes: String(resp.scope || '').split(/\s+/).filter(Boolean),
      account: (G.token && G.token.account) || {},
    };
    try {
      const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } });
      if (r.ok) {
        const u = await r.json();
        t.account = { id: u.sub, email: u.email, name: u.name, picture: u.picture };
        G.hint = u.email || G.hint;
      }
    } catch {}
    G.token = t;
    ui.clearNotice('google');
    scheduleGoogle();
    return t;
  }

  function scheduleGoogle() {
    clearTimeout(G.timer);
    if (!G.keepAlive || !G.token) return;
    const wait = Math.max(0, G.token.expires_at - RENEW_BEFORE - now()) * 1000;
    G.timer = setTimeout(googleRenewNotice, wait);
  }

  async function googleRenewNotice() {
    const t = G.token;
    if (!t) return;
    let prep;
    try { prep = await googlePrep(t.scopes); } catch { return; }
    const at = new Date(t.expires_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const show = (text) => ui.notice('google', text, 'Renew', () => {
      prep.start().catch((e) => { if (e.code !== 'cancelled') show(`Google sign-in could not be renewed: ${e.message}`); });
    });
    show(`Your Google sign-in expires at ${at}.`);
  }

  async function googleToken({ scopes = [], min_valid = 120, force = false, interactive = true, prompt, login_hint, mode }, signal) {
    const t = G.token;
    if (!force && t && gCovers(t.scopes, scopes) && t.expires_at - now() > min_valid) return t;
    if (!interactive) {
      throw new SSOError(t ? 'interaction_required' : 'not_signed_in',
        t ? 'The Google token must be renewed by the user' : 'Not signed in with Google');
    }
    const prep = await googlePrep(t && mode !== 'login' ? uniq([...t.scopes, ...scopes]) : scopes, { prompt, login_hint });
    return ui.interact({ provider: 'google', scopes: uniq([...GOOGLE_BASE, ...scopes]), mode: t && mode !== 'login' ? 'renew' : 'login', signal }, prep.start);
  }

  async function googleLogout() {
    clearTimeout(G.timer);
    const t = G.token;
    G.token = null;
    G.hint = null;
    ui.clearNotice('google');
    if (t) { try { (await gis()).revoke(t.access_token, () => {}); } catch {} }
  }

  /* ------------------------------------------------------------ Microsoft */
  const M = { app: null, key: '', mod: null, account: null, keepAlive: true, timers: new Map(), last: null };

  async function msal() {
    const c = await conf('microsoft');
    if (!c.client_id) {
      throw new SSOError('not_configured',
        'Microsoft sign-in is not set up. Add a "microsoft" client_id to sso.json or call sso.configure("microsoft", client_id=...).');
    }
    const authority = c.authority || `https://login.microsoftonline.com/${c.tenant || 'common'}`;
    const redirectUri = c.redirect_uri || new URL('auth/redirect.html', location.href).href;
    const key = [c.client_id, authority, redirectUri].join('|');
    if (M.app && M.key === key) return M.app;
    if (!M.mod) {
      try { M.mod = await import(MSAL_SRC); } catch { throw new SSOError('network', 'Could not load the Microsoft sign-in library'); }
    }
    const app = new M.mod.PublicClientApplication({
      auth: { clientId: c.client_id, authority, redirectUri, navigateToLoginRequestUrl: false },
      cache: { cacheLocation: 'sessionStorage' },
    });
    await app.initialize();
    M.app = app;
    M.key = key;
    M.account = app.getActiveAccount() || app.getAllAccounts()[0] || null;
    return app;
  }

  function isInteraction(e) {
    const c = e && e.errorCode;
    return !!((M.mod && M.mod.InteractionRequiredAuthError && e instanceof M.mod.InteractionRequiredAuthError) ||
      ['interaction_required', 'consent_required', 'login_required', 'no_tokens_found', 'no_account_error',
        'invalid_grant', 'refresh_token_expired', 'bad_token'].includes(c));
  }

  function msErr(e) {
    if (e instanceof SSOError) return e;
    if (isInteraction(e)) return new SSOError('interaction_required', (e && (e.errorMessage || e.message)) || 'Sign-in required');
    const code = (e && (e.errorCode || e.code)) || '';
    const map = {
      user_cancelled: 'cancelled', popup_window_error: 'popup_blocked', empty_window_error: 'popup_blocked',
      interaction_in_progress: 'busy', no_network_connectivity: 'network', post_request_failed: 'network',
      endpoints_resolution_error: 'network', access_denied: 'consent_denied',
    };
    return new SSOError(map[code] || 'error', (e && (e.errorMessage || e.message)) || String(e));
  }

  function msAccount(a) {
    return a ? { id: a.homeAccountId, email: a.username, name: a.name, tenant: a.tenantId } : null;
  }

  function msSave(r, scopes) {
    M.account = r.account;
    try { M.app.setActiveAccount(r.account); } catch {}
    const t = {
      provider: 'microsoft',
      access_token: r.accessToken,
      token_type: r.tokenType || 'Bearer',
      expires_at: r.expiresOn ? r.expiresOn.getTime() / 1000 : now() + 3600,
      scopes: r.scopes || scopes,
      account: msAccount(r.account) || {},
    };
    M.last = t;
    ui.clearNotice('microsoft');
    scheduleMs(scopes, t.expires_at);
    return t;
  }

  function scheduleMs(scopes, expiresAt) {
    if (!M.keepAlive) return;
    const key = [...scopes].sort().join(' ');
    clearTimeout(M.timers.get(key));
    const wait = Math.max(5, expiresAt - RENEW_BEFORE - now()) * 1000;
    M.timers.set(key, setTimeout(async () => {
      if (!M.app || !M.account) return;
      try {
        msSave(await M.app.acquireTokenSilent({ scopes, account: M.account, forceRefresh: true }), scopes);
      } catch (e) {
        if (isInteraction(e)) {
          ui.notice('microsoft', 'Your Microsoft sign-in must be renewed.', 'Renew', () => {
            M.app.acquireTokenPopup({ scopes, account: M.account || undefined })
              .then((r) => msSave(r, scopes)).catch(() => {});
          });
        } else {
          scheduleMs(scopes, now() + RENEW_BEFORE + 60); // network hiccup: try again in a minute
        }
      }
    }, wait));
  }

  async function msToken({ scopes, min_valid = 120, force = false, interactive = true, prompt, login_hint, mode }, signal) {
    const app = await msal();
    const c = await conf('microsoft');
    const sc = scopes && scopes.length ? scopes : (c.scopes && c.scopes.length ? c.scopes : ['User.Read']);
    const switching = mode === 'login' && force;
    if (M.account && !switching) {
      try {
        let r = await app.acquireTokenSilent({ scopes: sc, account: M.account, forceRefresh: !!force });
        if (r.expiresOn && r.expiresOn.getTime() / 1000 - now() < min_valid) {
          r = await app.acquireTokenSilent({ scopes: sc, account: M.account, forceRefresh: true });
        }
        return msSave(r, sc);
      } catch (e) {
        if (!isInteraction(e)) throw msErr(e);
      }
    }
    if (!interactive) {
      throw new SSOError(M.account ? 'interaction_required' : 'not_signed_in',
        M.account ? 'Microsoft requires the user to sign in again' : 'Not signed in with Microsoft');
    }
    // acquireTokenPopup opens its window synchronously, so it can run inside the dialog's click
    const start = () => app.acquireTokenPopup({
      scopes: sc,
      account: switching ? undefined : (M.account || undefined),
      prompt: prompt || undefined,
      loginHint: login_hint || undefined,
    }).then((r) => msSave(r, sc), (e) => { throw msErr(e); });
    return ui.interact({ provider: 'microsoft', scopes: sc, mode: M.account && !switching ? 'renew' : 'login', signal }, start);
  }

  async function msLogout() {
    for (const t of M.timers.values()) clearTimeout(t);
    M.timers.clear();
    ui.clearNotice('microsoft');
    if (M.app && M.account) {
      try { await M.app.clearCache({ account: M.account }); } catch {}
      try { M.app.setActiveAccount(null); } catch {}
    }
    M.account = null;
    M.last = null;
  }

  /* ------------------------------------------------------------ requests from Python */
  const check = (p) => {
    if (p !== 'google' && p !== 'microsoft') throw new SSOError('unknown_provider', `unknown provider ${p}`);
    return p;
  };

  const handlers = {
    'sso.login': async (a, ctx) => {
      const p = check(a.provider);
      const opts = {
        scopes: a.scopes || [], min_valid: 60, force: !!a.force, interactive: true, mode: 'login',
        prompt: a.prompt || (a.force ? 'select_account' : undefined), login_hint: a.login_hint,
      };
      if (p === 'google') { G.keepAlive = a.keep_alive !== false; return googleToken(opts, ctx.signal); }
      M.keepAlive = a.keep_alive !== false;
      return msToken(opts, ctx.signal);
    },
    'sso.token': async (a, ctx) => {
      const p = check(a.provider);
      const opts = { scopes: a.scopes || [], min_valid: a.min_valid == null ? 120 : a.min_valid, force: !!a.force, interactive: a.interactive !== false };
      return p === 'google' ? googleToken(opts, ctx.signal) : msToken(opts, ctx.signal);
    },
    'sso.logout': async (a) => {
      const p = check(a.provider);
      if (p === 'google') await googleLogout(); else await msLogout();
      return true;
    },
    'sso.status': async () => {
      const g = await conf('google');
      const m = await conf('microsoft');
      const gt = G.token;
      return {
        // what to register with the providers (see doc/sso.md)
        origin: location.origin,
        redirect_uri: m.redirect_uri || new URL('auth/redirect.html', location.href).href,
        google: {
          configured: !!g.client_id, signed_in: !!(gt && gt.expires_at > now()),
          account: gt ? gt.account : null, expires_at: gt ? gt.expires_at : null, scopes: gt ? gt.scopes : [],
        },
        microsoft: {
          configured: !!m.client_id, signed_in: !!M.account, account: msAccount(M.account),
          expires_at: M.last ? M.last.expires_at : null, scopes: M.last ? M.last.scopes : [],
        },
      };
    },
    'sso.configure': async (a) => {
      const p = check(a.provider);
      overrides[p] = { ...overrides[p], ...(a.config || {}) };
      if (p === 'microsoft') { M.app = null; M.key = ''; }
      return { configured: !!(await conf(p)).client_id };
    },
  };

  return { handlers };
}
