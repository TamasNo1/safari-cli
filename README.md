# safari-cli

A command-line tool to control Safari on macOS via WebDriver. No MCP server needed — just a standalone CLI.

Talks directly to `safaridriver` (built into macOS) using the W3C WebDriver protocol. Session state is persisted to `~/.safari-cli/session.json` so commands work across terminal invocations.

## Prerequisites

- **macOS** (Safari and SafariDriver are macOS-only)
- **Node.js 18+**
- **Safari** with Remote Automation enabled:
  1. Safari → Settings → Advanced → check "Show features for web developers"
  2. Develop menu → Allow Remote Automation
  3. Run once: `sudo safaridriver --enable`

## Install

```bash
# From this directory
npm install
npm run build
npm link    # makes `safari-cli` available globally

# Or run directly
node dist/cli.js <command>
```

## Quick Start

```bash
# Start a Safari session
safari-cli start

# Navigate
safari-cli navigate https://example.com

# Page info
safari-cli info
# Title: Example Domain
# URL:   https://example.com/

# Take a screenshot
safari-cli screenshot --output page.png

# Execute JavaScript
safari-cli execute 'document.title'

# Read console logs
safari-cli console

# Inspect an element
safari-cli inspect 'h1'

# Click an element
safari-cli click 'a[href]'

# Stop the session
safari-cli stop
```

## Commands

### Session Management

| Command | Description |
|---------|-------------|
| `start [--port PORT]` | Start SafariDriver + create browser session (default port: 9515) |
| `stop` | Close session and kill SafariDriver |
| `status` | Show session status, PID, current URL |

### Navigation

| Command | Description |
|---------|-------------|
| `navigate <url>` / `go <url>` | Navigate to a URL (auto-prepends `https://`) |
| `back` | Go back |
| `forward` | Go forward |
| `refresh` | Reload the page |

### Page Information

| Command | Description |
|---------|-------------|
| `info` | Get page title and URL |
| `source [-o file]` | Get page source HTML |
| `html [selector] [-o file]` | Get outerHTML of element or full page |
| `perf` | Performance metrics (load times, paint, transfer size) |

### Screenshots

| Command | Description |
|---------|-------------|
| `screenshot [-o file] [-s selector]` | Capture page or element screenshot as PNG |

### Developer Console

| Command | Description |
|---------|-------------|
| `console [--level LEVEL] [--inject]` | Get captured console logs (LOG, WARN, ERROR, INFO, DEBUG) |
| `console-clear` | Clear captured console logs |
| `network [--inject]` | Get captured network requests (fetch + XHR) |
| `network-clear` | Clear captured network logs |

> **Note:** Console/network capture works by injecting JavaScript hooks. The first call to `console` or `network` auto-injects the hooks. Logs from before injection won't be captured. Use `--inject` to set up capture early.

### JavaScript Execution

| Command | Description |
|---------|-------------|
| `execute <script>` / `eval <script>` | Execute JS in browser context |
| `execute --async <script>` | Execute async JS (call `arguments[0]` to resolve) |

Multi-statement scripts work: `safari-cli execute 'console.log("hi"); 42'`

### DOM Interaction

| Command | Description |
|---------|-------------|
| `inspect <selector>` | Inspect element (tag, text, rect, attributes, visibility) |
| `click <selector>` | Click an element |
| `type <selector> <text> [--clear]` | Type text into input element |
| `find <selector> [--text]` | Find all matching elements |
| `wait <selector> [-t ms]` | Wait for element to appear (default: 10s) |

Selectors are CSS by default. XPath if starting with `//`.

### Cookies

| Command | Description |
|---------|-------------|
| `cookies [--json]` | List all cookies |

### Window Management

| Command | Description |
|---------|-------------|
| `resize [-w W -h H]` | Get or set window size |
| `resize --maximize` | Maximize window |
| `resize --fullscreen` | Fullscreen window |
| `tabs` | List open tabs/windows |
| `tab <handle>` | Switch to a tab by handle |

### Alerts & Frames

| Command | Description |
|---------|-------------|
| `alert [--accept] [--dismiss] [--text T]` | Handle browser alerts/prompts |
| `frame [id]` | Switch iframe (no arg = top level) |

## Architecture

```
safari-cli
├── src/
│   ├── cli.ts          # Commander-based CLI with all commands
│   ├── webdriver.ts    # Raw W3C WebDriver HTTP client (no selenium)
│   └── session.ts      # Session state persistence (~/.safari-cli/)
├── package.json
└── tsconfig.json
```

- **Zero heavy dependencies** — only `commander` for CLI parsing
- Talks to `safaridriver` via raw HTTP (`fetch()`) using the W3C WebDriver protocol
- Session state stored in `~/.safari-cli/session.json` so commands work across terminal invocations
- Console/network logging via injected JavaScript hooks (same approach as safari-mcp-server)

## Scripting Examples

```bash
# Full workflow
safari-cli start
safari-cli navigate https://news.ycombinator.com
safari-cli console --inject
safari-cli network --inject
safari-cli screenshot --output hn.png
safari-cli execute 'document.querySelectorAll(".titleline a").length'
safari-cli find '.titleline a' --text
safari-cli console
safari-cli network
safari-cli stop

# Quick page audit
safari-cli start && safari-cli go https://mysite.com
safari-cli perf
safari-cli execute 'document.querySelectorAll("img:not([alt])").length'
safari-cli stop

# Fill a form
safari-cli type '#email' 'user@example.com'
safari-cli type '#password' 'secret' --clear
safari-cli click 'button[type=submit]'
safari-cli wait '.dashboard'
```

## Troubleshooting

- **"Cannot connect to SafariDriver"** — Run `sudo safaridriver --enable` and enable Develop → Allow Remote Automation in Safari
- **"Session is stale"** — Run `safari-cli stop` then `safari-cli start`
- **Console logs empty** — Hooks are injected on first `console` call. Logs from before that aren't captured. Use `console --inject` early.
- **Only one session at a time** — Safari WebDriver only supports a single session

## License

MIT
