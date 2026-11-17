"""Sign-in demo: Google and Microsoft access tokens with pyterm.sso.

The page does the sign-in (a dialog, then the provider's pop-up); this program only gets
the access token and calls the APIs itself with pyfetch. Client IDs come from sso.json on
the site, or from the `setup` command for this session. See doc/sso.md.

Commands: status, login, me, token, refresh, logout, setup (type help).
"""
import functools
import inspect
import time

import pyterm
from pyterm import sso
from pyterm.console import style, table

NAMES = {"google": "Google", "microsoft": "Microsoft"}
ALIASES = {"g": "google", "gmail": "google", "m": "microsoft", "ms": "microsoft",
           "azure": "microsoft", "entra": "microsoft", "outlook": "microsoft"}
# profile API of each provider and the scopes it needs
PROFILE = {
    "google": ("https://www.googleapis.com/oauth2/v3/userinfo", ["openid", "email", "profile"]),
    "microsoft": ("https://graph.microsoft.com/v1.0/me", ["User.Read"]),
}
HINTS = {
    "not_configured": "Add its client ID to sso.json (see doc/sso.md), or type: setup {p} <client-id>",
    "popup_blocked": "Allow pop-ups for this site, then try again.",
    "not_signed_in": "Sign in first: login {p}",
    "interaction_required": "Sign in again: login {p}",
    "network": "Check the internet connection.",
}

app = pyterm.App(
    "signin",
    intro=(style("Sign-in demo", bold=True) + " — Google and Microsoft access tokens for your Python code.\n"
           + style("login google · login microsoft · me <provider> · token <provider> · help", "grey")),
)


def provider_of(name):
    p = ALIASES.get(str(name).lower(), str(name).lower())
    if p not in NAMES:
        raise ValueError(f"Unknown provider {name!r}: use google or microsoft.")
    return p


def friendly(fn):
    """Show sign-in errors as one readable line instead of a traceback."""
    @functools.wraps(fn)
    async def wrapper(*args):
        try:
            r = fn(*args)
            return (await r) if inspect.isawaitable(r) else r
        except sso.SSOError as e:
            p = ALIASES.get(str(args[0]).lower(), str(args[0]).lower()) if args else "google"
            print(style(f"✘ {e}", "red"))
            hint = HINTS.get(e.code)
            if hint:
                print(style("  " + hint.format(p=p), "grey"))
        except ValueError as e:
            print(style(str(e), "yellow"))
    return wrapper


def until(ts):
    secs = int(ts - time.time())
    if secs <= 0:
        return "expired"
    return f"{secs // 60} min left" if secs >= 60 else f"{secs} s left"


@app.command
@friendly
async def status():
    """Show which providers are set up and who is signed in."""
    st = await sso.astatus()
    rows = []
    for p, name in NAMES.items():
        s = st.get(p) or {}
        if not s.get("configured"):
            state = style("not set up", "grey")
        elif s.get("signed_in"):
            state = style("signed in", "green")
        else:
            state = style("signed out", "yellow")
        acct = s.get("account") or {}
        who = acct.get("email") or acct.get("name") or ""
        rows.append((name, state, who, until(s["expires_at"]) if s.get("expires_at") else ""))
    table(rows, headers=["Provider", "State", "Account", "Token"])
    if not all((st.get(p) or {}).get("configured") for p in NAMES):
        print(style("\nSet a provider up in sso.json (doc/sso.md), or for this session: setup google <client-id>", "grey"))
        print(style("  Google    → authorized JavaScript origin: ", "grey") + st.get("origin", ""))
        print(style("  Microsoft → SPA redirect URI:              ", "grey") + st.get("redirect_uri", ""))


@app.command
@friendly
async def login(provider, *scopes):
    """Sign in with google or microsoft, optionally asking for more scopes."""
    p = provider_of(provider)
    tok = await sso.alogin(p, list(scopes) or None)
    who = tok.account.get("email") or tok.account.get("name") or "your account"
    print(f"{style('✔', 'green')} Signed in to {NAMES[p]} as {style(who, bold=True)}")
    print(style(f"  Token: {until(tok.expires_at)} · {len(tok.scopes)} scopes · renewed automatically", "grey"))


@app.command
@friendly
async def me(provider):
    """Call the provider's profile API with the access token."""
    from pyodide.http import pyfetch

    p = provider_of(provider)
    url, scopes = PROFILE[p]
    tok = await sso.atoken(p, scopes)  # cached, refreshed, or one click to renew
    r = await pyfetch(url, headers=tok.headers())
    if not r.ok:
        print(style(f"✘ {url} answered {r.status}", "red"))
        return
    data = await r.json()
    rows = [(k, v) for k, v in data.items()
            if not k.startswith("@") and v not in (None, "", []) and not isinstance(v, (dict, list))]
    print(style(f"GET {url}", "grey"))
    table(rows[:16])


@app.command
@friendly
async def token(provider):
    """Show the current access token (shortened), its scopes and expiry."""
    p = provider_of(provider)
    tok = await sso.atoken(p, interactive=False)
    t = tok.access_token
    short = t[:10] + "…" + t[-6:] if len(t) > 24 else t
    table([
        ("access_token", short + style(f"  ({len(t)} chars)", "grey")),
        ("expires", time.strftime("%H:%M:%S", time.localtime(tok.expires_at)) + style(f"  ({until(tok.expires_at)})", "grey")),
        ("account", tok.account.get("email") or tok.account.get("name") or ""),
        ("scopes", ", ".join(s.rsplit("/", 1)[-1] for s in tok.scopes)),
    ])


@app.command
@friendly
async def refresh(provider):
    """Get a new token now (Microsoft: silently; Google: asks to renew)."""
    p = provider_of(provider)
    tok = await sso.atoken(p, force=True)
    print(f"{style('✔', 'green')} New {NAMES[p]} token, {until(tok.expires_at)}")


@app.command
@friendly
async def logout(provider=None):
    """Sign out of one provider, or of both."""
    await sso.alogout(provider_of(provider) if provider else None)
    print(style("Signed out.", "grey"))


@app.command
@friendly
async def setup(provider, client_id, tenant=None):
    """Use a client ID for this session (instead of editing sso.json)."""
    p = provider_of(provider)
    kw = {"client_id": client_id}
    if tenant and p == "microsoft":
        kw["tenant"] = tenant
    await sso.aconfigure(p, **kw)
    print(f"{style('✔', 'green')} {NAMES[p]} set up for this session. Now: login {p}")


app.execute("status")
app.run()
