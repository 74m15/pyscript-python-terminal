# Sign-in with Google and Microsoft (`pyterm.sso`)

Programs running in PyTerm can sign the user in with **Google** or **Microsoft** and get **OAuth 2.0 access tokens** to call their APIs (Gmail, Drive, Calendar, Microsoft Graph, Outlook, OneDrive, Teams…). The sign-in runs on the page (main thread); Python, which runs in a worker, asks for it through the page bridge and receives the token.

PyTerm only gets and renews tokens. **API calls are made by your program**, with `pyfetch` or any HTTP client, using the token.

- [How it works](#how-it-works)
- [Quick start](#quick-start)
- [Setting up Google](#setting-up-google)
- [Setting up Microsoft](#setting-up-microsoft)
- [sso.json](#ssojson)
- [Python API](#python-api)
- [Token renewal](#token-renewal)
- [Errors](#errors)
- [Examples](#examples)
- [Security notes](#security-notes)
- [Limits](#limits)

---

## How it works

```
Python (worker)                     Page (main thread)                         Provider
──────────────                      ──────────────────                         ────────
sso.login("microsoft", [...]) ──rpc "sso.login"──► sso.js
                                    cached / silent token? ── yes ──► token ─┐
                                    no → dialog "Sign in with Microsoft"     │
                                    user clicks Continue ──► pop-up ───────► login + consent
                                    ◄────────────────────────── code / token ┘
Token(access_token, expires_at, …) ◄──rpc_result──
```

- **Google**: [Google Identity Services](https://developers.google.com/identity/oauth2/web/guides/use-token-model) token model (`initTokenClient` + `requestAccessToken`). The library is loaded from `accounts.google.com/gsi/client` the first time it is needed.
- **Microsoft**: [MSAL.js](https://learn.microsoft.com/entra/identity-platform/msal-overview) (`@azure/msal-browser` 4.x from jsDelivr): authorization code flow with PKCE, refresh tokens, `acquireTokenSilent` / `acquireTokenPopup`. Works with personal Microsoft accounts and work/school (Entra ID) accounts.
- Browsers only open pop-ups from a click, so the first sign-in (and every renewal that needs the user) shows a small **PyTerm dialog**: *Continue* opens the provider's window, *Cancel* raises `SSOError("cancelled")` in Python. Stop/Ctrl+C while the dialog is open closes it and raises `KeyboardInterrupt`.

## Quick start

1. Register PyTerm with the provider (below) and put the client ID in [`sso.json`](#ssojson).
2. In the REPL or in a program:

```python
>>> from pyterm import sso
>>> from pyodide.http import pyfetch
>>> tok = sso.login("microsoft", ["User.Read"])     # dialog + pop-up the first time
>>> r = await pyfetch("https://graph.microsoft.com/v1.0/me", headers=tok.headers())
>>> (await r.json())["displayName"]
'Ada Lovelace'
```

Or try the bundled **Sign-in demo** (Programs menu, or `run("signin")`): `status`, `login google`, `me google`, `token microsoft`, `refresh microsoft`, `logout`. Without an `sso.json` entry you can still try it for one session with `setup google <client-id>`.

`sso.status()` (and the demo's `status`) also prints the exact **origin** and **redirect URI** to register for the address PyTerm is running at.

## Setting up Google

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select or create a project.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name and support e-mail, and add the scopes you need. While the app is in *Testing*, add the Google accounts that may sign in as **test users**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
4. Under **Authorized JavaScript origins** add every address PyTerm runs at, without a path and without a trailing slash, for example:
   - `https://charming-camel-7180.puter.site` (published site)
   - your custom domain, if any
   - `http://localhost:8000` for local development
   
   No redirect URI is needed (the token model uses a pop-up).
5. Copy the **Client ID** (`…apps.googleusercontent.com`) into `sso.json` → `google.client_id`.
6. Enable the APIs you will call (Gmail API, Drive API, Calendar API…) under **APIs & Services → Library**.

Google scopes are full URLs (`https://www.googleapis.com/auth/drive.readonly`); `openid`, `email` and `profile` are always requested so PyTerm can show who is signed in. Sensitive or restricted scopes need Google's verification before the app can be used by everyone.

## Setting up Microsoft

1. Open [Microsoft Entra admin center](https://entra.microsoft.com/) (or Azure Portal) → **App registrations → New registration**.
2. **Supported account types**: pick who may sign in. *Accounts in any organizational directory and personal Microsoft accounts* matches `"tenant": "common"`.
3. **Redirect URI**: platform **Single-page application (SPA)**, URI `https://<your-site>/auth/redirect.html`, for example `https://charming-camel-7180.puter.site/auth/redirect.html`. Add one per address (custom domain, `http://localhost:8000/auth/redirect.html`, …) under **Authentication**.
4. Copy the **Application (client) ID** into `sso.json` → `microsoft.client_id`.
5. Under **API permissions** add the delegated Microsoft Graph permissions you need (`User.Read` is there by default; e.g. `Mail.Read`, `Calendars.Read`, `Files.Read`). Users are asked to consent the first time; some permissions need admin consent in work/school tenants.

`auth/redirect.html` is the page the Microsoft pop-up returns to. MSAL reads the result from it and closes the window; keep it free of app code.

## sso.json

At the site root, next to `index.html`. Client IDs are public identifiers (not secrets), so they can be published.

```json
{
  "google": {
    "client_id": "1234567890-abc.apps.googleusercontent.com",
    "scopes": []
  },
  "microsoft": {
    "client_id": "00000000-0000-0000-0000-000000000000",
    "tenant": "common",
    "scopes": ["User.Read"]
  }
}
```

| Key | Provider | Meaning |
|---|---|---|
| `client_id` | both | OAuth client ID / Application ID. Empty = provider not set up (`SSOError("not_configured")`) |
| `scopes` | both | Scopes requested when a call doesn't pass any. Google always adds `openid email profile`; Microsoft defaults to `["User.Read"]` |
| `tenant` | microsoft | `common` (any account), `organizations` (work/school only), `consumers` (personal only), or a tenant ID / domain |
| `authority` | microsoft | Full authority URL instead of `tenant` (e.g. `https://login.microsoftonline.com/contoso.onmicrosoft.com`) |
| `redirect_uri` | microsoft | Overrides the default `<site>/auth/redirect.html` |

A program can override any of these for the current session with `sso.configure()`.

## Python API

```python
from pyterm import sso
```

Every function has an **async twin** with an `a` prefix (`alogin`, `atoken`, …) for `await`. The plain versions wait with stack switching (like `input()`), so they need Chrome/Edge/Firefox with JSPI; the async ones work everywhere.

| Function | Returns | Description |
|---|---|---|
| `login(provider, scopes=None, *, prompt=None, login_hint=None, keep_alive=True, force=False)` | `Token` | Sign in if needed. A valid cached token covering the scopes is returned without any dialog. `force=True` signs in again (e.g. another account); `prompt="select_account"` / `"consent"` forces those screens |
| `token(provider, scopes=None, *, min_valid=120, force=False, interactive=True)` | `Token` | A token valid for at least `min_valid` seconds: cached, silently refreshed (Microsoft), or renewed with one click. `interactive=False` never shows a dialog and raises `SSOError("interaction_required" / "not_signed_in")` instead. `force=True` always gets a new token |
| `access_token(provider, scopes=None, **kw)` | `str` | Just the token string |
| `logout(provider=None)` | — | Forget the tokens of one provider or both (Google tokens are also revoked) |
| `status()` | `dict` | `{"origin", "redirect_uri", "google": {...}, "microsoft": {...}}` with `configured`, `signed_in`, `account`, `expires_at`, `scopes` per provider |
| `configure(provider, *, client_id=None, tenant=None, authority=None, scopes=None, redirect_uri=None)` | `dict` | Override `sso.json` for this session |
| `Session(provider, scopes=None, *, keep_alive=True)` | — | Provider + scopes pair with `login()`, `token()`, `access_token()`, `headers(extra=None)`, `logout()` and their async twins |

`provider` is `"google"` or `"microsoft"`. `scopes` is a list or a space/comma separated string.

### `Token`

| Attribute | Description |
|---|---|
| `provider` | `"google"` or `"microsoft"` |
| `access_token` | The bearer token (`str(token)` gives it too) |
| `token_type` | `"Bearer"` |
| `expires_at` | Unix time |
| `expires_in`, `expired` | Seconds left / whether it has expired |
| `scopes` | Granted scopes |
| `account` | `{"id", "email", "name", ...}` (Google adds `picture`, Microsoft `tenant`) |
| `headers(extra=None)` | `{"Authorization": "Bearer …"}` plus `extra` |

`repr(token)` never shows the secret.

## Token renewal

| | Google | Microsoft |
|---|---|---|
| Token lifetime | ~1 hour | ~1 hour (refresh token: 24 h for SPAs, renewed on use) |
| Cached token | reused while valid | reused while valid |
| `token()` near expiry | renewal needs the user: one-click dialog | `acquireTokenSilent` with the refresh token, no UI |
| `keep_alive=True` (default) | 5 min before expiry a **notice** appears at the bottom right: *Your Google sign-in expires at 14:05 — Renew* | the token is **refreshed silently** 5 min before expiry; a *Renew* notice appears only if Microsoft requires the user (session expired, password changed, new consent) |
| Where tokens live | page memory | MSAL cache in `sessionStorage` (this tab) |

Long-running programs should call `sso.token(...)` (or `session.headers()`) **before each API call** instead of keeping a `Token` object: it is instant when the cached token is still valid and renews it when it isn't.

Reloading the page signs the user out of Google (memory only); Microsoft keeps the account for the browser tab session.

## Errors

`sso.SSOError` with a `code`:

| code | Meaning |
|---|---|
| `not_configured` | No client ID for the provider (`sso.json` or `configure()`) |
| `not_signed_in` | `interactive=False` and nobody is signed in |
| `interaction_required` | `interactive=False` and the user must act (Google expiry, revoked consent, new scopes) |
| `cancelled` | The user pressed Cancel or closed the pop-up |
| `popup_blocked` | The browser blocked the pop-up. The dialog shows the hint and *Try again* |
| `consent_denied` | The user refused the permissions |
| `network` | The provider's library or endpoints could not be reached |
| `busy` | Another sign-in dialog or pop-up is already open |
| `unknown_provider` | Not `google` / `microsoft` |
| `error` | Anything else (the message has the provider's text) |

Pressing **Stop** while Python waits for the sign-in raises `KeyboardInterrupt`.

## Examples

### Microsoft Graph: latest e-mails

```python
from pyterm import sso
from pyodide.http import pyfetch

graph = sso.Session("microsoft", ["User.Read", "Mail.Read"])
graph.login()

r = await pyfetch("https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,from",
                  headers=graph.headers())
for m in (await r.json())["value"]:
    print(m["from"]["emailAddress"]["name"], "—", m["subject"])
```

### Google Drive: list files

```python
from pyterm import sso
from pyodide.http import pyfetch

DRIVE = ["https://www.googleapis.com/auth/drive.metadata.readonly"]
tok = await sso.alogin("google", DRIVE)
r = await pyfetch("https://www.googleapis.com/drive/v3/files?pageSize=10&fields=files(name,mimeType)",
                  headers=tok.headers())
for f in (await r.json())["files"]:
    print(f["name"], f["mimeType"])
```

### A long-running job

```python
import time
from pyterm import sso

cal = sso.Session("google", ["https://www.googleapis.com/auth/calendar.readonly"])
cal.login()
while True:
    headers = cal.headers()          # renewed when needed
    ...                              # call the API
    time.sleep(600)
```

### Requests with `requests`

`pyodide-http` patches `requests` to use the browser's fetch:

```python
import pyterm; pyterm.require("requests", "pyodide-http")
import pyodide_http, requests
pyodide_http.patch_all()
r = requests.get("https://graph.microsoft.com/v1.0/me", headers=sso.token("microsoft").headers())
```

## Security notes

- Access tokens stay in the browser tab: they are never sent to PyTerm's site or to any server other than the provider and the APIs your program calls.
- Any code typed in the REPL or run as a program can ask for a token. The dialog shows **which program asks** and **which permissions**, and nothing happens without the user's click (or an existing sign-in for the same scopes).
- Ask only for the scopes you need, and prefer read-only scopes.
- `logout()` forgets tokens (and revokes Google's). Closing the tab forgets everything.

## Limits

- Google's browser token model has **no refresh token**, so renewing after expiry always needs a click (the notice makes it one click; `keep_alive=False` disables it).
- Pop-ups must be allowed for the site.
- Inside the Puter desktop, PyTerm runs in an iframe: sign-in pop-ups work, but the iframe's origin (`*.puter.site` / the app's origin) is what must be registered.
- Microsoft personal accounts can't use work-only permissions, and some Graph permissions need an administrator's consent.
