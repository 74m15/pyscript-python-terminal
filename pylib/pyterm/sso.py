"""pyterm.sso — sign in with Google or Microsoft and get OAuth 2.0 access tokens.

The sign-in itself runs on the PyTerm page (Google Identity Services and Microsoft MSAL):
a dialog asks the user to continue, the provider's pop-up opens, and the access token comes
back to Python. Tokens are renewed automatically when possible (Microsoft refresh tokens) or
with a one-click "Renew" prompt (Google), so long-running programs don't time out.

Calls to the providers' APIs are made by your program, with the token:

    from pyterm import sso
    from pyodide.http import pyfetch

    tok = sso.login("microsoft", ["User.Read"])          # dialog + pop-up the first time
    r = await pyfetch("https://graph.microsoft.com/v1.0/me", headers=tok.headers())

    tok = sso.token("google", ["https://www.googleapis.com/auth/drive.readonly"])
    # → a valid token: cached, refreshed, or (Google, after expiry) one click to renew

Every function has an async twin (``alogin``, ``atoken``, …) for code that uses ``await``;
the plain ones need WebAssembly stack switching, like ``input()``.

Client IDs come from ``sso.json`` on the site or from ``configure()``. See doc/sso.md.
"""
import time

from . import _bridge
from .console import _await

__all__ = [
    "PROVIDERS", "SSOError", "Token", "Session",
    "login", "alogin", "token", "atoken", "access_token", "aaccess_token",
    "logout", "alogout", "status", "astatus", "configure", "aconfigure",
]

PROVIDERS = ("google", "microsoft")


class SSOError(Exception):
    """Sign-in failed. ``code`` is one of: not_configured, not_signed_in, cancelled,
    popup_blocked, consent_denied, interaction_required, network, unknown_provider, busy, error."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Token:
    """An OAuth access token.

    Attributes: provider, access_token, token_type, expires_at (Unix time), scopes (granted),
    account (dict: id, email, name, …). ``expires_in`` and ``expired`` are computed.
    """

    def __init__(self, data):
        self.provider = data.get("provider")
        self.access_token = data.get("access_token") or ""
        self.token_type = data.get("token_type") or "Bearer"
        self.expires_at = float(data.get("expires_at") or 0)
        self.scopes = list(data.get("scopes") or [])
        self.account = dict(data.get("account") or {})

    @property
    def expires_in(self):
        """Seconds until the token expires (0 when expired)."""
        return max(0, int(self.expires_at - time.time()))

    @property
    def expired(self):
        return self.expires_in <= 0

    def headers(self, extra=None):
        """HTTP headers for an API call: {"Authorization": "Bearer …"} plus ``extra``."""
        h = {"Authorization": f"{self.token_type} {self.access_token}"}
        if extra:
            h.update(extra)
        return h

    def __str__(self):
        return self.access_token

    def __repr__(self):  # never print the secret by accident
        who = self.account.get("email") or self.account.get("name") or "?"
        return f"<Token {self.provider} {who} expires in {self.expires_in}s scopes={len(self.scopes)}>"


def _check(provider):
    p = str(provider or "").lower()
    if p not in PROVIDERS:
        raise SSOError("unknown_provider", f"unknown provider {provider!r} (use one of {', '.join(PROVIDERS)})")
    return p


def _scopes(scopes):
    if scopes is None:
        return None
    if isinstance(scopes, str):
        return [s for s in scopes.replace(",", " ").split() if s]
    return [str(s) for s in scopes]


async def _req(name, args):
    try:
        return await _bridge.acall("sso." + name, args)
    except _bridge.BridgeError as e:
        raise SSOError(e.code, str(e)) from None


# ---------------------------------------------------------------- functions
async def alogin(provider, scopes=None, *, prompt=None, login_hint=None, keep_alive=True, force=False):
    """Sign in (if needed) and return a Token for ``scopes``.

    The first time, a dialog asks the user to continue and the provider's pop-up opens.
    When the user is already signed in with these scopes, the cached token is returned
    without any dialog (use ``force=True`` to sign in again, e.g. with another account).
    ``prompt``: "select_account" or "consent" to force those screens. ``keep_alive``: renew
    the token before it expires (silently for Microsoft, with a one-click notice for Google).
    """
    data = await _req("login", {
        "provider": _check(provider), "scopes": _scopes(scopes), "prompt": prompt,
        "login_hint": login_hint, "keep_alive": bool(keep_alive), "force": bool(force),
    })
    return Token(data)


def login(provider, scopes=None, **kw):
    return _await(alogin(provider, scopes, **kw))


async def atoken(provider, scopes=None, *, min_valid=120, force=False, interactive=True):
    """Return a Token valid for at least ``min_valid`` seconds.

    Cached tokens are reused; Microsoft tokens are refreshed silently; when that isn't
    possible (Google tokens after expiry, revoked consent, new scopes) the user is asked to
    renew with one click, unless ``interactive=False`` (then SSOError("interaction_required")).
    ``force=True`` always gets a fresh token.
    """
    data = await _req("token", {
        "provider": _check(provider), "scopes": _scopes(scopes), "min_valid": int(min_valid),
        "force": bool(force), "interactive": bool(interactive),
    })
    return Token(data)


def token(provider, scopes=None, **kw):
    return _await(atoken(provider, scopes, **kw))


async def aaccess_token(provider, scopes=None, **kw):
    """Just the access token string (see atoken)."""
    return (await atoken(provider, scopes, **kw)).access_token


def access_token(provider, scopes=None, **kw):
    return _await(aaccess_token(provider, scopes, **kw))


async def alogout(provider=None):
    """Forget the tokens of one provider (or of both). Google tokens are also revoked."""
    providers = [_check(provider)] if provider else list(PROVIDERS)
    for p in providers:
        await _req("logout", {"provider": p})


def logout(provider=None):
    return _await(alogout(provider))


async def astatus():
    """Who is signed in, plus what to register with the providers:

    {"origin": "https://…",                     # Google: authorized JavaScript origin
     "redirect_uri": "https://…/auth/redirect.html",  # Microsoft: SPA redirect URI
     "google": {"configured", "signed_in", "account", "expires_at", "scopes"},
     "microsoft": {…}}
    """
    return await _req("status", {})


def status():
    return _await(astatus())


async def aconfigure(provider, *, client_id=None, tenant=None, authority=None, scopes=None, redirect_uri=None):
    """Set or override a provider's settings for this session (instead of / on top of sso.json).

    google:    client_id (OAuth client of type "Web application"), scopes (defaults)
    microsoft: client_id (Application ID of an app registration with a "Single-page
               application" platform), tenant ("common", "organizations", "consumers" or a
               tenant id), authority (full URL, instead of tenant), redirect_uri, scopes
    """
    cfg = {k: v for k, v in {
        "client_id": client_id, "tenant": tenant, "authority": authority,
        "scopes": _scopes(scopes), "redirect_uri": redirect_uri,
    }.items() if v is not None}
    return await _req("configure", {"provider": _check(provider), "config": cfg})


def configure(provider, **kw):
    return _await(aconfigure(provider, **kw))


# ---------------------------------------------------------------- Session
class Session:
    """A provider + scopes pair, handy when a program calls one API many times:

        graph = sso.Session("microsoft", ["User.Read", "Mail.Read"])
        graph.login()
        ...
        r = await pyfetch(url, headers=graph.headers())   # always a valid token
    """

    def __init__(self, provider, scopes=None, *, keep_alive=True):
        self.provider = _check(provider)
        self.scopes = _scopes(scopes)
        self.keep_alive = keep_alive
        self.last = None

    @property
    def account(self):
        return self.last.account if self.last else {}

    async def alogin(self, **kw):
        kw.setdefault("keep_alive", self.keep_alive)
        self.last = await alogin(self.provider, self.scopes, **kw)
        return self.last

    def login(self, **kw):
        return _await(self.alogin(**kw))

    async def atoken(self, **kw):
        self.last = await atoken(self.provider, self.scopes, **kw)
        return self.last

    def token(self, **kw):
        return _await(self.atoken(**kw))

    async def aaccess_token(self, **kw):
        return (await self.atoken(**kw)).access_token

    def access_token(self, **kw):
        return _await(self.aaccess_token(**kw))

    async def aheaders(self, extra=None, **kw):
        return (await self.atoken(**kw)).headers(extra)

    def headers(self, extra=None, **kw):
        return _await(self.aheaders(extra, **kw))

    async def alogout(self):
        self.last = None
        await alogout(self.provider)

    def logout(self):
        return _await(self.alogout())

    def __repr__(self):
        return f"<Session {self.provider} scopes={self.scopes}>"
