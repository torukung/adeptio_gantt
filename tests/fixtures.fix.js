// @ts-check
/* Shared Playwright fixture for the Adeptio Gantt suite.
 *
 * HARD SAFETY RULE (see SPEC "Playwright harness"): the app pushes the WHOLE doc
 * to the production Cloudflare Worker + D1 on every Store.save(). A test that
 * reaches that host can corrupt live customer data. Therefore EVERY browser
 * context created through this `test` blocks the production API before any page
 * script runs, and every test asserts (in teardown) that nothing reached the
 * host and that no uncaught page error occurred.
 *
 * Every spec MUST import { test, expect } from this file — never straight from
 * '@playwright/test' — so the block and the pageerror guard are unconditional.
 */
const base = require("@playwright/test");

const PROD_HOST = "adeptio-gantt.pathom-bot.workers.dev";
const PROD_GLOB = "https://" + PROD_HOST + "/**";
const PROD_RE = /adeptio-gantt\.pathom-bot\.workers\.dev/i;
const isProd = (url) => PROD_RE.test(url);

const test = base.test.extend({
  // Install the abort route on the CONTEXT before the page fixture creates a page,
  // so the very first navigation (which triggers cloudSync's fetch) is intercepted.
  context: async ({ context }, use) => {
    await context.route(PROD_GLOB, (route) => route.abort());
    await context.route(PROD_RE, (route) => route.abort()); // belt-and-suspenders: any scheme/path/query
    await use(context);
  },
  page: async ({ page }, use) => {
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    // If the block ever leaked, an aborted request fires 'requestfailed', NOT
    // 'requestfinished'/'response'. So a prod URL appearing here means it escaped.
    const escaped = [];
    page.on("requestfinished", (r) => { if (isProd(r.url())) escaped.push("finished " + r.url()); });
    page.on("response", (r) => { if (isProd(r.url())) escaped.push("response " + r.url()); });

    await use(page);

    base.expect(escaped, "network reached production host (data-safety leak): " + escaped.join(", ")).toHaveLength(0);
    base.expect(
      pageErrors,
      "uncaught page error(s): " + pageErrors.map((e) => e && e.message).join("  ||  ")
    ).toHaveLength(0);
  },
});

const expect = base.expect;

module.exports = { test, expect, PROD_HOST, PROD_GLOB, PROD_RE, isProd };
