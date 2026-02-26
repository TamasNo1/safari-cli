#!/usr/bin/env node

/**
 * safari-cli — Control Safari from the command line via WebDriver.
 */

import { program } from 'commander';
import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebDriver, WebDriverError } from './webdriver.js';
import {
  loadSession,
  saveSession,
  clearSession,
  requireSession,
  SessionState,
} from './session.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDriver(session: SessionState): WebDriver {
  return new WebDriver(session.port);
}

/** Check if a process is still alive */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Wait until safaridriver is ready */
async function waitForDriver(port: number, timeoutMs = 10000): Promise<void> {
  const driver = new WebDriver(port);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await driver.getStatus();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error(`SafariDriver did not start within ${timeoutMs}ms`);
}

/** Resolve CSS / XPath selector strategy */
function selectorStrategy(selector: string): { using: string; value: string } {
  if (selector.startsWith('//') || selector.startsWith('(//')) {
    return { using: 'xpath', value: selector };
  }
  return { using: 'css selector', value: selector };
}

// JS snippets injected into the page for console/network capture
const INJECT_CONSOLE = `
if (!window.__safariCLI_console) {
  window.__safariCLI_console = [];
  const orig = {};
  ['log','warn','error','info','debug'].forEach(m => {
    orig[m] = console[m];
    console[m] = function(...args) {
      const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
      window.__safariCLI_console.push({ level: m.toUpperCase(), message: msg, timestamp: Date.now() });
      orig[m].apply(console, args);
    };
  });
  // capture uncaught errors
  window.addEventListener('error', e => {
    window.__safariCLI_console.push({ level: 'ERROR', message: e.message + ' at ' + e.filename + ':' + e.lineno, timestamp: Date.now() });
  });
  window.addEventListener('unhandledrejection', e => {
    window.__safariCLI_console.push({ level: 'ERROR', message: 'Unhandled rejection: ' + String(e.reason), timestamp: Date.now() });
  });
}
return 'ok';
`;

const INJECT_NETWORK = `
if (!window.__safariCLI_network) {
  window.__safariCLI_network = [];
  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const method = args[1]?.method || 'GET';
    const entry = { method, url, timestamp: Date.now(), status: null, duration: null };
    const start = performance.now();
    try {
      const resp = await origFetch.apply(this, args);
      entry.status = resp.status;
      entry.duration = Math.round(performance.now() - start);
      window.__safariCLI_network.push(entry);
      return resp;
    } catch(e) {
      entry.status = 0;
      entry.duration = Math.round(performance.now() - start);
      entry.error = String(e);
      window.__safariCLI_network.push(entry);
      throw e;
    }
  };
  // Intercept XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this.__safariCLI = { method, url, timestamp: Date.now() };
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function() {
    const meta = this.__safariCLI;
    if (meta) {
      const start = performance.now();
      this.addEventListener('loadend', () => {
        meta.status = this.status;
        meta.duration = Math.round(performance.now() - start);
        window.__safariCLI_network.push(meta);
      });
    }
    return origSend.apply(this, arguments);
  };
}
return 'ok';
`;

// ---------------------------------------------------------------------------
// CLI Definition
// ---------------------------------------------------------------------------

program
  .name('safari-cli')
  .description('Control Safari from the command line via WebDriver')
  .version('0.0.6');

// ---- start ----------------------------------------------------------------
program
  .command('start')
  .description('Start SafariDriver and create a browser session')
  .option('-p, --port <port>', 'SafariDriver port', '9515')
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);

    // Check for existing session
    const existing = loadSession();
    if (existing && isProcessAlive(existing.pid)) {
      console.log(
        `Session already active (pid=${existing.pid}, port=${existing.port}, session=${existing.sessionId})`
      );
      return;
    }

    // Start safaridriver
    console.error(`Starting safaridriver on port ${port}...`);
    const child = spawn('safaridriver', ['-p', String(port)], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    if (!child.pid) {
      console.error('Failed to start safaridriver');
      process.exit(1);
    }

    try {
      await waitForDriver(port);
    } catch (e: any) {
      console.error(e.message);
      try { process.kill(child.pid); } catch { /* ignore */ }
      process.exit(1);
    }

    // Create session
    const driver = new WebDriver(port);
    let sessionId: string;
    try {
      sessionId = await driver.createSession();
    } catch (e: any) {
      console.error(`Failed to create session: ${e.message}`);
      try { process.kill(child.pid); } catch { /* ignore */ }
      process.exit(1);
    }

    saveSession({
      port,
      sessionId,
      pid: child.pid,
      startedAt: new Date().toISOString(),
    });

    console.log(`Safari session started`);
    console.log(`  Port:      ${port}`);
    console.log(`  Session:   ${sessionId}`);
    console.log(`  PID:       ${child.pid}`);
  });

// ---- stop -----------------------------------------------------------------
program
  .command('stop')
  .description('Close Safari session and stop SafariDriver')
  .action(async () => {
    const session = loadSession();
    if (!session) {
      console.log('No active session.');
      return;
    }

    const driver = getDriver(session);
    try {
      await driver.deleteSession(session.sessionId);
    } catch { /* session may already be dead */ }

    if (isProcessAlive(session.pid)) {
      try {
        process.kill(session.pid, 'SIGTERM');
        console.log(`Stopped safaridriver (pid=${session.pid})`);
      } catch { /* ignore */ }
    }

    clearSession();
    console.log('Session closed.');
  });

// ---- status ---------------------------------------------------------------
program
  .command('status')
  .description('Show current session status')
  .action(async () => {
    const session = loadSession();
    if (!session) {
      console.log('No active session.');
      return;
    }

    const alive = isProcessAlive(session.pid);
    console.log(`Session:     ${session.sessionId}`);
    console.log(`Port:        ${session.port}`);
    console.log(`PID:         ${session.pid} (${alive ? 'running' : 'DEAD'})`);
    console.log(`Started:     ${session.startedAt}`);

    if (alive) {
      const driver = getDriver(session);
      try {
        const url = await driver.getCurrentUrl(session.sessionId);
        const title = await driver.getTitle(session.sessionId);
        console.log(`Current URL: ${url}`);
        console.log(`Page Title:  ${title}`);
      } catch { /* session might be stale */ }
    }
  });

// ---- navigate -------------------------------------------------------------
program
  .command('navigate <url>')
  .alias('go')
  .description('Navigate to a URL')
  .action(async (url: string) => {
    const session = requireSession();
    const driver = getDriver(session);
    // Auto-add https:// if missing
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    await driver.navigateTo(session.sessionId, url);
    console.log(`Navigated to ${url}`);
  });

// ---- back / forward / refresh ---------------------------------------------
program
  .command('back')
  .description('Go back')
  .action(async () => {
    const session = requireSession();
    await getDriver(session).back(session.sessionId);
    console.log('Navigated back.');
  });

program
  .command('forward')
  .description('Go forward')
  .action(async () => {
    const session = requireSession();
    await getDriver(session).forward(session.sessionId);
    console.log('Navigated forward.');
  });

program
  .command('refresh')
  .description('Refresh the page')
  .action(async () => {
    const session = requireSession();
    await getDriver(session).refresh(session.sessionId);
    console.log('Page refreshed.');
  });

// ---- info -----------------------------------------------------------------
program
  .command('info')
  .description('Get page title and URL')
  .action(async () => {
    const session = requireSession();
    const driver = getDriver(session);
    const [url, title] = await Promise.all([
      driver.getCurrentUrl(session.sessionId),
      driver.getTitle(session.sessionId),
    ]);
    console.log(`Title: ${title}`);
    console.log(`URL:   ${url}`);
  });

// ---- source ---------------------------------------------------------------
program
  .command('source')
  .description('Get page source HTML')
  .option('-o, --output <file>', 'Write to file instead of stdout')
  .action(async (opts) => {
    const session = requireSession();
    const source = await getDriver(session).getPageSource(session.sessionId);
    if (opts.output) {
      writeFileSync(resolve(opts.output), source);
      console.error(`Saved to ${opts.output}`);
    } else {
      process.stdout.write(source);
    }
  });

// ---- screenshot -----------------------------------------------------------
program
  .command('screenshot')
  .description('Take a screenshot')
  .option('-o, --output <file>', 'Output file path (default: screenshot-<timestamp>.png)')
  .option('-s, --selector <selector>', 'Screenshot a specific element')
  .action(async (opts) => {
    const session = requireSession();
    const driver = getDriver(session);
    let base64: string;

    if (opts.selector) {
      const { using, value } = selectorStrategy(opts.selector);
      const elementId = await driver.findElement(session.sessionId, using, value);
      base64 = await driver.takeElementScreenshot(session.sessionId, elementId);
    } else {
      base64 = await driver.takeScreenshot(session.sessionId);
    }

    const filename = opts.output || `screenshot-${Date.now()}.png`;
    const filepath = resolve(filename);
    writeFileSync(filepath, Buffer.from(base64, 'base64'));

    // Downscale to 1x logical resolution on Retina displays
    const dpr: number = await driver.executeScript(
      session.sessionId,
      'return window.devicePixelRatio || 1;'
    );
    if (dpr > 1) {
      const sipsOut = execSync(
        `sips -g pixelWidth "${filepath}" 2>/dev/null | tail -1 | awk '{print $2}'`
      ).toString().trim();
      const currentWidth = parseInt(sipsOut, 10);
      if (currentWidth > 0) {
        const targetWidth = Math.round(currentWidth / dpr);
        execSync(`sips --resampleWidth ${targetWidth} "${filepath}" >/dev/null 2>&1`);
      }
    }

    console.log(filepath);
  });

// ---- console --------------------------------------------------------------
program
  .command('console')
  .description('Get captured console logs')
  .option('-l, --level <level>', 'Filter by level (LOG, WARN, ERROR, INFO, DEBUG)')
  .option('--inject', 'Just inject the capture hook (for pages loaded without it)')
  .action(async (opts) => {
    const session = requireSession();
    const driver = getDriver(session);

    // Always ensure injection
    await driver.executeScript(session.sessionId, INJECT_CONSOLE);

    if (opts.inject) {
      console.log('Console capture injected.');
      return;
    }

    let logs: any[] = await driver.executeScript(
      session.sessionId,
      'return window.__safariCLI_console || [];'
    );

    if (opts.level) {
      const level = opts.level.toUpperCase();
      logs = logs.filter((l: any) => l.level === level);
    }

    if (logs.length === 0) {
      console.log('No console logs captured.');
      return;
    }

    for (const entry of logs) {
      const time = new Date(entry.timestamp).toISOString().slice(11, 23);
      const levelTag = entry.level.padEnd(5);
      console.log(`[${time}] ${levelTag} ${entry.message}`);
    }
  });

// ---- console-clear --------------------------------------------------------
program
  .command('console-clear')
  .description('Clear captured console logs')
  .action(async () => {
    const session = requireSession();
    await getDriver(session).executeScript(
      session.sessionId,
      'window.__safariCLI_console = []; return "ok";'
    );
    console.log('Console logs cleared.');
  });

// ---- network --------------------------------------------------------------
program
  .command('network')
  .description('Get captured network logs')
  .option('--inject', 'Just inject the capture hook')
  .action(async (opts) => {
    const session = requireSession();
    const driver = getDriver(session);

    await driver.executeScript(session.sessionId, INJECT_NETWORK);

    if (opts.inject) {
      console.log('Network capture injected.');
      return;
    }

    const logs: any[] = await driver.executeScript(
      session.sessionId,
      'return window.__safariCLI_network || [];'
    );

    if (logs.length === 0) {
      console.log('No network logs captured.');
      return;
    }

    for (const entry of logs) {
      const status = entry.status != null ? String(entry.status) : '???';
      const dur = entry.duration != null ? `${entry.duration}ms` : '';
      console.log(
        `${entry.method.padEnd(6)} ${status.padEnd(4)} ${dur.padStart(8)}  ${entry.url}`
      );
    }
  });

// ---- network-clear --------------------------------------------------------
program
  .command('network-clear')
  .description('Clear captured network logs')
  .action(async () => {
    const session = requireSession();
    await getDriver(session).executeScript(
      session.sessionId,
      'window.__safariCLI_network = []; return "ok";'
    );
    console.log('Network logs cleared.');
  });

// ---- execute --------------------------------------------------------------
program
  .command('execute <script>')
  .alias('eval')
  .description('Execute JavaScript in the browser')
  .option('--async', 'Execute as async script (must call arguments[0] callback)')
  .action(async (script: string, opts) => {
    const session = requireSession();
    const driver = getDriver(session);

    let result;
    if (opts.async) {
      result = await driver.executeAsyncScript(session.sessionId, script);
    } else {
      // If script already has return, use as-is.
      // If it's a single expression, wrap with return.
      // If multi-statement, wrap the last expression with return via IIFE.
      let toRun: string;
      if (/^\s*return\s/m.test(script)) {
        toRun = script;
      } else if (/;/.test(script)) {
        // Multi-statement: wrap last statement's value
        const stmts = script.split(';').map((s) => s.trim()).filter(Boolean);
        const last = stmts.pop() || '';
        const prefix = stmts.length > 0 ? stmts.join('; ') + '; ' : '';
        toRun = `${prefix}return ${last}`;
      } else {
        toRun = `return ${script}`;
      }
      try {
        result = await driver.executeScript(session.sessionId, toRun);
      } catch {
        // If wrapping failed, try raw
        result = await driver.executeScript(session.sessionId, script);
      }
    }

    if (result !== undefined && result !== null) {
      if (typeof result === 'object') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(String(result));
      }
    }
  });

// ---- inspect --------------------------------------------------------------
program
  .command('inspect <selector>')
  .description('Inspect a DOM element')
  .action(async (selector: string) => {
    const session = requireSession();
    const driver = getDriver(session);
    const { using, value } = selectorStrategy(selector);
    const elementId = await driver.findElement(session.sessionId, using, value);

    const elRef = { 'element-6066-11e4-a52e-4f735466cecf': elementId };

    const [tagName, text, rect] = await Promise.all([
      driver.getElementTagName(session.sessionId, elementId),
      driver.getElementText(session.sessionId, elementId),
      driver.getElementRect(session.sessionId, elementId),
    ]);

    // Get attributes, visibility, and enabled via JS (Safari doesn't support /displayed endpoint)
    const extras = await driver.executeScript(
      session.sessionId,
      `
      const el = arguments[0];
      const attrs = {};
      for (const attr of el.attributes) attrs[attr.name] = attr.value;
      const style = window.getComputedStyle(el);
      const displayed = style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
      return { attrs, displayed, enabled: !el.disabled };
      `,
      [elRef]
    );

    console.log(`Tag:       <${tagName}>`);
    console.log(`Text:      ${text.substring(0, 200) || '(empty)'}`);
    console.log(`Rect:      x=${rect.x} y=${rect.y} w=${rect.width} h=${rect.height}`);
    console.log(`Displayed: ${extras.displayed}`);
    console.log(`Enabled:   ${extras.enabled}`);
    const attrs = extras.attrs;
    if (attrs && Object.keys(attrs).length > 0) {
      console.log(`Attributes:`);
      for (const [k, v] of Object.entries(attrs)) {
        console.log(`  ${k}="${v}"`);
      }
    }
  });

// ---- click ----------------------------------------------------------------
program
  .command('click <selector>')
  .description('Click a DOM element')
  .action(async (selector: string) => {
    const session = requireSession();
    const driver = getDriver(session);
    const { using, value } = selectorStrategy(selector);
    const elementId = await driver.findElement(session.sessionId, using, value);
    await driver.clickElement(session.sessionId, elementId);
    console.log(`Clicked: ${selector}`);
  });

// ---- type -----------------------------------------------------------------
program
  .command('type <selector> <text>')
  .description('Type text into a DOM element')
  .option('--clear', 'Clear the field first')
  .action(async (selector: string, text: string, opts) => {
    const session = requireSession();
    const driver = getDriver(session);
    const { using, value } = selectorStrategy(selector);
    const elementId = await driver.findElement(session.sessionId, using, value);
    if (opts.clear) {
      await driver.clearElement(session.sessionId, elementId);
    }
    await driver.sendKeys(session.sessionId, elementId, text);
    console.log(`Typed into: ${selector}`);
  });

// ---- find -----------------------------------------------------------------
program
  .command('find <selector>')
  .description('Find elements matching a selector')
  .option('--text', 'Show element text')
  .action(async (selector: string, opts) => {
    const session = requireSession();
    const driver = getDriver(session);
    const { using, value } = selectorStrategy(selector);
    const elements = await driver.findElements(session.sessionId, using, value);

    console.log(`Found ${elements.length} element(s)`);
    for (let i = 0; i < elements.length; i++) {
      const tag = await driver.getElementTagName(session.sessionId, elements[i]);
      let line = `  [${i}] <${tag}>`;
      if (opts.text) {
        const text = await driver.getElementText(session.sessionId, elements[i]);
        if (text) line += ` "${text.substring(0, 80)}"`;
      }
      console.log(line);
    }
  });

// ---- html -----------------------------------------------------------------
program
  .command('html [selector]')
  .description('Get outerHTML of an element (or full page)')
  .option('-o, --output <file>', 'Write to file')
  .action(async (selector: string | undefined, opts) => {
    const session = requireSession();
    const driver = getDriver(session);

    let html: string;
    if (selector) {
      const { using, value } = selectorStrategy(selector);
      const elementId = await driver.findElement(session.sessionId, using, value);
      html = await driver.executeScript(
        session.sessionId,
        'return arguments[0].outerHTML;',
        [{ 'element-6066-11e4-a52e-4f735466cecf': elementId }]
      );
    } else {
      html = await driver.getPageSource(session.sessionId);
    }

    if (opts.output) {
      writeFileSync(resolve(opts.output), html);
      console.error(`Saved to ${opts.output}`);
    } else {
      process.stdout.write(html + '\n');
    }
  });

// ---- perf -----------------------------------------------------------------
program
  .command('perf')
  .description('Get page performance metrics')
  .action(async () => {
    const session = requireSession();
    const driver = getDriver(session);

    const metrics = await driver.executeScript(
      session.sessionId,
      `
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paint = performance.getEntriesByType('paint');
      const fp = paint.find(e => e.name === 'first-paint');
      const fcp = paint.find(e => e.name === 'first-contentful-paint');
      const resources = performance.getEntriesByType('resource');
      return {
        url: location.href,
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
        loadComplete: Math.round(nav.loadEventEnd || 0),
        firstPaint: fp ? Math.round(fp.startTime) : null,
        firstContentfulPaint: fcp ? Math.round(fcp.startTime) : null,
        domInteractive: Math.round(nav.domInteractive || 0),
        responseTime: Math.round((nav.responseEnd || 0) - (nav.requestStart || 0)),
        resourceCount: resources.length,
        totalTransferSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
      };
      `
    );

    console.log(`URL:                    ${metrics.url}`);
    console.log(`DOM Content Loaded:     ${metrics.domContentLoaded}ms`);
    console.log(`Load Complete:          ${metrics.loadComplete}ms`);
    console.log(`DOM Interactive:        ${metrics.domInteractive}ms`);
    console.log(`First Paint:            ${metrics.firstPaint != null ? metrics.firstPaint + 'ms' : 'N/A'}`);
    console.log(`First Contentful Paint: ${metrics.firstContentfulPaint != null ? metrics.firstContentfulPaint + 'ms' : 'N/A'}`);
    console.log(`Response Time:          ${metrics.responseTime}ms`);
    console.log(`Resources:              ${metrics.resourceCount}`);
    console.log(`Transfer Size:          ${(metrics.totalTransferSize / 1024).toFixed(1)} KB`);
  });

// ---- cookies --------------------------------------------------------------
program
  .command('cookies')
  .description('List all cookies')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    const session = requireSession();
    const cookies = await getDriver(session).getCookies(session.sessionId);

    if (opts.json) {
      console.log(JSON.stringify(cookies, null, 2));
      return;
    }

    if (cookies.length === 0) {
      console.log('No cookies.');
      return;
    }

    for (const c of cookies) {
      console.log(`${c.name}=${c.value}`);
      if (c.domain) console.log(`  domain: ${c.domain}`);
      if (c.path) console.log(`  path: ${c.path}`);
      if (c.expiry) console.log(`  expires: ${new Date(c.expiry * 1000).toISOString()}`);
      if (c.secure) console.log(`  secure: true`);
      if (c.httpOnly) console.log(`  httpOnly: true`);
    }
  });

// ---- resize ---------------------------------------------------------------
program
  .command('resize')
  .description('Get or set window size')
  .option('-w, --width <width>', 'Window width')
  .option('-h, --height <height>', 'Window height')
  .option('--maximize', 'Maximize window')
  .option('--fullscreen', 'Fullscreen window')
  .action(async (opts) => {
    const session = requireSession();
    const driver = getDriver(session);

    if (opts.maximize) {
      await driver.maximizeWindow(session.sessionId);
      console.log('Window maximized.');
      return;
    }
    if (opts.fullscreen) {
      await driver.fullscreenWindow(session.sessionId);
      console.log('Window fullscreened.');
      return;
    }
    if (opts.width || opts.height) {
      const rect: any = {};
      if (opts.width) rect.width = parseInt(opts.width, 10);
      if (opts.height) rect.height = parseInt(opts.height, 10);
      await driver.setWindowRect(session.sessionId, rect);
      console.log(`Window resized to ${rect.width || '?'}×${rect.height || '?'}`);
      return;
    }

    // Just show current size
    const rect = await driver.getWindowRect(session.sessionId);
    console.log(`Position: ${rect.x}, ${rect.y}`);
    console.log(`Size:     ${rect.width}×${rect.height}`);
  });

// ---- tabs -----------------------------------------------------------------
program
  .command('tabs')
  .description('List open tabs/windows')
  .action(async () => {
    const session = requireSession();
    const driver = getDriver(session);
    const handles = await driver.getWindowHandles(session.sessionId);
    const current = await driver.getWindowHandle(session.sessionId);

    for (const handle of handles) {
      const marker = handle === current ? '→' : ' ';
      // Try to get title by switching
      if (handle !== current) {
        try {
          await driver.switchToWindow(session.sessionId, handle);
          const title = await driver.getTitle(session.sessionId);
          const url = await driver.getCurrentUrl(session.sessionId);
          console.log(`${marker} ${handle}  ${title}  (${url})`);
        } catch {
          console.log(`${marker} ${handle}`);
        }
      } else {
        const title = await driver.getTitle(session.sessionId);
        const url = await driver.getCurrentUrl(session.sessionId);
        console.log(`${marker} ${handle}  ${title}  (${url})`);
      }
    }
    // Switch back
    if (handles.length > 1) {
      await driver.switchToWindow(session.sessionId, current);
    }
  });

// ---- tab ------------------------------------------------------------------
program
  .command('tab <handle>')
  .description('Switch to a tab/window by handle')
  .action(async (handle: string) => {
    const session = requireSession();
    await getDriver(session).switchToWindow(session.sessionId, handle);
    const driver = getDriver(session);
    const title = await driver.getTitle(session.sessionId);
    console.log(`Switched to: ${title}`);
  });

// ---- wait -----------------------------------------------------------------
program
  .command('wait <selector>')
  .description('Wait for an element to appear')
  .option('-t, --timeout <ms>', 'Timeout in milliseconds', '10000')
  .action(async (selector: string, opts) => {
    const session = requireSession();
    const driver = getDriver(session);
    const { using, value } = selectorStrategy(selector);
    const timeout = parseInt(opts.timeout, 10);
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        await driver.findElement(session.sessionId, using, value);
        console.log(`Element found: ${selector}`);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    console.error(`Timeout: element not found after ${timeout}ms: ${selector}`);
    process.exit(1);
  });

// ---- alert ----------------------------------------------------------------
program
  .command('alert')
  .description('Get alert text, accept, or dismiss')
  .option('--accept', 'Accept the alert')
  .option('--dismiss', 'Dismiss the alert')
  .option('--text <text>', 'Send text to a prompt')
  .action(async (opts) => {
    const session = requireSession();
    const driver = getDriver(session);

    if (opts.text) {
      await driver.sendAlertText(session.sessionId, opts.text);
    }
    if (opts.accept) {
      await driver.acceptAlert(session.sessionId);
      console.log('Alert accepted.');
    } else if (opts.dismiss) {
      await driver.dismissAlert(session.sessionId);
      console.log('Alert dismissed.');
    } else {
      const text = await driver.getAlertText(session.sessionId);
      console.log(`Alert: ${text}`);
    }
  });

// ---- frame ----------------------------------------------------------------
program
  .command('frame [id]')
  .description('Switch to an iframe (no arg = top-level)')
  .action(async (id?: string) => {
    const session = requireSession();
    const driver = getDriver(session);

    if (id === undefined) {
      await driver.switchToFrame(session.sessionId, null);
      console.log('Switched to top-level frame.');
    } else {
      const frameId = /^\d+$/.test(id) ? parseInt(id, 10) : id;
      await driver.switchToFrame(session.sessionId, frameId);
      console.log(`Switched to frame: ${id}`);
    }
  });

// ---- Error handling -------------------------------------------------------
program.hook('postAction', () => {});

// Global error handler
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err: any) {
    if (err instanceof WebDriverError) {
      console.error(`Error: ${err.message}`);
      if (err.webdriverError === 'invalid session id') {
        console.error('Session is stale. Run `safari-cli stop` then `safari-cli start`.');
        clearSession();
      }
    } else {
      console.error(`Error: ${err.message || err}`);
    }
    process.exit(1);
  }
}

main();
