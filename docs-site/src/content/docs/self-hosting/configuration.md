---
title: Configuration
description: Every environment variable Oyla reads, with defaults, and the limits that are built in.
---

Oyla is configured with environment variables only. It checks them at startup and refuses to start
when one is invalid, with a message that names the problem:

```text
Invalid configuration: OYLA_RETENTION_DAYS: must be a whole number
```

Oyla doesn't load a `.env` file on its own. Set the variables in your shell, with `docker run -e`
or `--env-file`, in Compose, or in your host's settings.

## All variables

| Variable | Default | What it does |
|---|---|---|
| [`PORT`](#port) | `3000` | HTTP port |
| [`HOST`](#host) | `0.0.0.0` | Address to listen on |
| [`OYLA_DB_PATH`](#oyla_db_path) | `./data/oyla.db` | SQLite file (`/data/oyla.db` in the Docker image) |
| [`OYLA_CREATE_PASSWORD`](#oyla_create_password) | unset | Password needed to create a presentation |
| [`OYLA_CENTRAL_SESSION_URL`](#teacher-accounts-optional) | unset | Internal identity-service origin; enables teacher accounts |
| [`OYLA_APP_TOKEN_FILE`](#teacher-accounts-optional) | unset | File containing the application token for the identity service |
| [`OYLA_COMMONS_URL`](#teacher-accounts-optional) | `https://commons.edutictac.es` | Public Commons origin for the account chip and login |
| [`OYLA_PUBLIC_URL`](#teacher-accounts-optional) | `https://oyla.edutictac.es` | Public origin allowed to send writes |
| [`OYLA_RETENTION_DAYS`](#oyla_retention_days) | `30` | Delete presentations unused for this many days; `0` keeps them |
| [`OYLA_TRUST_PROXY`](#oyla_trust_proxy) | `false` | Number of reverse proxies in front of Oyla |
| [`OYLA_WEB_DIST`](#oyla_web_dist) | `packages/web/dist` | Built web app to serve |
| [`OYLA_LOG_LEVEL`](#oyla_log_level) | `info` | Log level |
| [`OYLA_RATE_LIMIT_API_PER_MINUTE`](#oyla_rate_limit_api_per_minute) | `600` | API requests per minute per client IP |
| [`OYLA_RATE_LIMIT_CREATE_PER_HOUR`](#oyla_rate_limit_create_per_hour) | `10` | New presentations per hour per client IP |
| [`OYLA_MAX_DB_MB`](#oyla_max_db_mb) | `1024` | Largest database file in MB; `0` means no limit |

## `PORT`

The HTTP port, a whole number from 0 to 65535. Default `3000`. The web app, the API and the
Socket.IO connections all share this port. Platforms such as Railway set it for you.

## `HOST`

The address to listen on. Default `0.0.0.0`, which accepts connections on every network
interface. Use `127.0.0.1` to accept local connections only, for example when a reverse proxy on
the same machine is the only way in.

## `OYLA_DB_PATH`

Path of the SQLite database file. Default `./data/oyla.db`, relative to the working directory; the
Docker image sets `/data/oyla.db`. Oyla creates the folder if it doesn't exist and applies database
migrations on startup.

`:memory:` keeps the database in memory, which the tests use. Everything is lost when the process
stops.

## `OYLA_CREATE_PASSWORD`

When set, creating a presentation requires this password; the **New presentation** form then shows
a **Server password** field. Joining, answering and editing with an admin link never need it. An
empty value counts as unset.

Use it for a private instance on a public address. The comparison runs in constant time and the
password is never logged. Keep it at most 200 characters, the longest password the API accepts.

## Teacher accounts (optional)

By default Oyla uses private admin links and needs no accounts. The EduTicTac deployment can
instead use the shared account chip: teachers sign in to create and keep presentations, and only
the owner account can edit or present them. Joining and answering never need an account.

Setting `OYLA_CENTRAL_SESSION_URL` enables the integration. These variables go with it:

- **`OYLA_CENTRAL_SESSION_URL`**: internal origin of the EduTicTac identity service, for example
  `http://127.0.0.1:8005`. Oyla calls `GET /api/internal/session/resolve` with the signed session
  cookies and the application token. Only `http` and `https` URLs without credentials are accepted.
- **`OYLA_APP_TOKEN_FILE`**: path to a file with the application token that identifies Oyla to the
  identity service. The token must be at least 24 characters. Keep the file outside the repository,
  mount it read-only and never expose it through the public proxy. `OYLA_APP_TOKEN` accepts the
  token directly, but a file is safer.
- **`OYLA_COMMONS_URL`**: public Commons origin used for the account chip, the login link and the
  content security policy. Default `https://commons.edutictac.es`.
- **`OYLA_PUBLIC_URL`**: public origin of this Oyla instance. Writes must send exactly this
  `Origin`, which protects them against cross-site requests. Default `https://oyla.edutictac.es`.

With the integration enabled, `/api/config` reports `accountEnabled: true`, `/api/account/session`
describes the current session and the start page shows the account chip. Creating a presentation
without a teacher session is refused with HTTP 401. Accepted roles are `profesor`, `professorat`
and `administrador`. If `OYLA_CREATE_PASSWORD` is also set, both the session and the password are
required. Session checks apply to editing, exports and every live presenter command, and open
presenter connections are checked periodically so a revoked session stops presenting.

If the identity service cannot be reached, account access is denied (fail closed). The public join
flow keeps working.

Ownership is stored in the additive `presentation_owners` table; existing questions, answers and
private links are untouched. Back up the database before enabling accounts. Presentations saved to
an account are excluded from `OYLA_RETENTION_DAYS`; deleting one explicitly still removes its
questions and answers. After presentations belong to accounts, roll back only to a version that
enforces ownership.

## `OYLA_RETENTION_DAYS`

Presentations that nobody used for this many days are deleted, with their questions and answers.
Default `30`. `0` keeps presentations forever.

Opening a presentation in the editor, editing it, presenting it, and participants joining or
answering all count as use. The cleanup runs when the server starts and then every hour. Connected
phones of a deleted presentation see **This presentation has ended**.

## `OYLA_TRUST_PROXY`

How many reverse proxies sit in front of Oyla. Accepts `false` (0, the default), `true` (1) or a
single digit from `0` to `9`.

Oyla uses the client's IP address for rate limits and for the cap on connections per address.
Behind a proxy, every request arrives from the proxy's address, so without this setting all your
visitors share one rate limit. With it, Oyla reads the client address from the `X-Forwarded-For`
header, counting the given number of entries from the right, where your own proxies wrote them.

| Setup | Value |
|---|---|
| Container port published directly to the internet | `false` |
| One reverse proxy (Caddy, nginx, Traefik) or a platform such as Railway | `true` |
| Two proxies, for example a CDN in front of nginx | `2` |

:::caution
Don't set a higher number than you have proxies. Clients can write anything into the left part of
`X-Forwarded-For`, and trusting too many entries lets them pick the address that rate limits apply
to.
:::

## `OYLA_WEB_DIST`

Folder of the built web app, the output of `npm run build` in `packages/web`. Default
`packages/web/dist`, resolved relative to the server package. You only need this when you move the
build somewhere else.

If the folder has no `index.html`, Oyla serves the API only and logs
`No built web app found; serving the API only`. That is expected during `npm run dev` on a fresh
checkout, where Vite serves the web app on port 5173.

## `OYLA_LOG_LEVEL`

One of `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Default `info`. Logs are
JSON lines on standard output. The `Authorization` header is redacted, and admin tokens and the
create password never appear in logs.

## `OYLA_RATE_LIMIT_API_PER_MINUTE`

Requests per minute per client IP for the REST API. Default `600`. It applies to every `/api` route
except `/api/health` and creating a presentation, which has its own limit. A client over the limit
gets HTTP 429 and the web app shows **Too many requests. Wait a moment and try again.**

## `OYLA_RATE_LIMIT_CREATE_PER_HOUR`

New presentations per hour per client IP. Default `10`. Lower it on an instance open to the
internet if you see abuse, or set `OYLA_CREATE_PASSWORD`.

## `OYLA_MAX_DB_MB`

The largest size the SQLite file may grow to, in megabytes. Default `1024`; `0` removes the limit.
When the database is full, new presentations and answers are refused with **The server is out of
storage. Tell whoever runs it.** instead of filling the disk. Keep it below the size of your
volume.

## Built-in limits

These limits are part of the code and not configurable.

| Limit | Value |
|---|---|
| REST request body | 64 KB |
| Socket.IO message | 16 KB |
| Live connections per client IP | 500 (generous, because a classroom often shares one public IP) |
| Join attempts per connection | 5 at once, then one every 2 seconds |
| Answers per connection | 10 at once, then one per second |
| Presenter commands per connection | 20 at once, then 5 per second |
| Results updates sent to the presenter | at most one every 250 ms per question |

Content limits such as 50 questions per presentation and 2,000 answers per question are listed on
the [question types page](/guide/question-types/#limits-for-every-type).
