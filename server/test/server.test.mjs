// server/test/server.test.mjs — the app around the Ads module, over real HTTP against a real server.js and a throwaway data directory:
// the first account owns the install, sign-up is closed after it unless AP_SIGNUP=open, workspaces never see each other's clients, the
// Google sign-in refuses to start without a client and asks only for Ads + email when it does, and an account can only be picked from
// the list Google returned. Nothing leaves the machine.
//
// Run: node server/test/server.test.mjs

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

async function boot({ port, signup, setupKey = "" }) {
  const dir = mkdtempSync(join(tmpdir(), "ap-srv-"));
  const child = spawn(process.execPath, [join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(port), AP_DATA_DIR: dir, AP_SIGNUP: signup, AP_SETUP_KEY: setupKey, AP_MASTER_KEY: "", AP_GOOGLE_CLIENT_ID: "", AP_GOOGLE_CLIENT_SECRET: "", AP_GADS_DEVELOPER_TOKEN: "", AP_MAIL_ENGINE: "none", AP_AI_ENGINE: "api", AP_AI_API_KEY: "", AP_APP_URL: `http://127.0.0.1:${port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  const stop = async () => {
    if (child.exitCode === null) {
      const done = once(child, "exit");
      child.kill();
      await done;
    }
    rmSync(dir, { recursive: true, force: true });
  };
  return { stop, log: () => log };
}

function client(port) {
  let cookie = "";
  return async (path, { method = "GET", body } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, redirect: "manual", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* empty */
    }
    return { status: res.status, body: json };
  };
}

const PW = "a-long-enough-password";

/* ---------------------------------------------------------------- closed sign-up */
{
  const s = await boot({ port: 4521, signup: "", setupKey: "claim-me" });
  try {
    const owner = client(4521);
    await check("the first account is created, owns its workspace and is the platform admin", async () => {
      const st = (await owner("/auth")).body;
      assert.equal(st.signupOpen, true, "the first sign-up is always open");
      assert.equal(st.setupKeyRequired, true);
      const wrong = await owner("/register", { method: "POST", body: { email: "thief@x.test", password: PW, name: "T", setupKey: "guess" } });
      assert.match(wrong.body.error, /setup key/, "without the key, a stranger cannot claim the install");
      const r = await owner("/register", { method: "POST", body: { email: "Owner@Agency.test", password: PW, name: "Owner", workspace: "Agency", setupKey: "claim-me" } });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const a = (await owner("/auth")).body;
      assert.equal(a.authed, true);
      assert.equal(a.org.role, "owner");
      assert.equal(a.platformAdmin, true);
      assert.equal(a.user.email, "owner@agency.test");
    });
    await check("after it, sign-up is closed unless AP_SIGNUP=open", async () => {
      const r = await client(4521)("/register", { method: "POST", body: { email: "x@y.test", password: PW, name: "X" } });
      assert.equal(r.status, 400);
      assert.match(r.body.error, /closed/);
    });
    await check("nothing behind the session line answers without one", async () => {
      assert.equal((await client(4521)("/projects")).status, 401);
    });
    await check("login: right password works, a wrong one and an unknown address get the same answer", async () => {
      const c = client(4521);
      const bad1 = await c("/login", { method: "POST", body: { email: "owner@agency.test", password: "wrong-password" } });
      const bad2 = await c("/login", { method: "POST", body: { email: "nobody@agency.test", password: "wrong-password" } });
      assert.equal(bad1.body.error, bad2.body.error);
      assert.equal((await c("/login", { method: "POST", body: { email: "OWNER@agency.test", password: PW } })).status, 200);
      assert.equal((await c("/projects")).status, 200);
      await c("/logout", { method: "POST" });
      assert.equal((await c("/projects")).status, 401);
    });
    await check("the owner adds a member with a password; a member cannot add people or delete a client", async () => {
      assert.equal((await owner("/members", { method: "POST", body: { email: "m@agency.test", password: PW, name: "M" } })).status, 200);
      const m = client(4521);
      assert.equal((await m("/login", { method: "POST", body: { email: "m@agency.test", password: PW } })).status, 200);
      assert.match((await m("/members", { method: "POST", body: { email: "z@agency.test", password: PW, name: "Z" } })).body.error, /owner or an admin/);
      const p = (await owner("/projects", { method: "POST", body: { name: "Acme" } })).body.project;
      assert.match((await m(`/projects/${p.id}/delete`, { method: "POST", body: { confirm: true } })).body.error, /owner or an admin/);
      assert.equal((await m("/projects")).body.projects.length, 1, "a member sees the workspace's clients");
    });
  } finally {
    await s.stop();
  }
}

/* ---------------------------------------------------------------- open sign-up: two workspaces, Google sign-in */
{
  const s = await boot({ port: 4522, signup: "open" });
  try {
    const a = client(4522);
    const b = client(4522);
    await a("/register", { method: "POST", body: { email: "a@one.test", password: PW, name: "A", workspace: "One" } });
    await b("/register", { method: "POST", body: { email: "b@two.test", password: PW, name: "B", workspace: "Two" } });
    const p = (await a("/projects", { method: "POST", body: { name: "Acme Plumbing" } })).body.project;

    await check("workspaces never see each other's clients, queue, alerts or Ads screen", async () => {
      assert.equal((await b("/projects")).body.projects.length, 0);
      for (const path of [`/projects/${p.id}/ads`, `/projects/${p.id}/google/connect`]) {
        const r = await b(path);
        assert.equal(r.status, 400, path);
        assert.match(r.body.error, /No such project/);
      }
      assert.match((await b(`/projects/${p.id}/google/account`, { method: "POST", body: { property: "1234567890" } })).body.error, /No such project/);
      assert.deepEqual((await b("/actions")).body.actions, []);
    });

    await check("the admin surface answers Not found to anyone but the platform admin", async () => {
      assert.match((await b("/admin/google")).body.error, /Not found/);
      assert.match((await b("/admin/gads")).body.error, /Not found/);
      assert.equal((await a("/admin/google")).status, 200);
    });

    await check("the Google sign-in will not start without a client; with one it asks only for Ads and the email, offline", async () => {
      assert.match((await a(`/projects/${p.id}/google/connect`)).body.error, /not set up/);
      const set = await a("/admin/google", { method: "POST", body: { clientId: "cid.apps.googleusercontent.com", clientSecret: "shh" } });
      assert.equal(set.status, 200);
      assert.equal(set.body.hasSecret, true);
      assert.ok(!JSON.stringify(set.body).includes("shh"), "the secret is never handed back");
      const r = await a(`/projects/${p.id}/google/connect`);
      const url = new URL(r.body.url);
      assert.deepEqual(url.searchParams.get("scope").split(" ").sort(), ["https://www.googleapis.com/auth/adwords", "https://www.googleapis.com/auth/userinfo.email"]);
      assert.equal(url.searchParams.get("access_type"), "offline");
      assert.equal(url.searchParams.get("redirect_uri"), "http://127.0.0.1:4522/oauth/google/callback");
    });

    await check("a callback with an unknown state does nothing and says the link expired", async () => {
      const r = await fetch("http://127.0.0.1:4522/oauth/google/callback?state=nope&code=x", { redirect: "manual" });
      assert.equal(r.status, 302);
      assert.match(decodeURIComponent(r.headers.get("location")), /expired/);
    });

    await check("before Google is connected, picking an account or syncing is refused in words", async () => {
      assert.match((await a(`/projects/${p.id}/google/account`, { method: "POST", body: { property: "1234567890" } })).body.error, /Connect Google Ads first/);
      assert.match((await a(`/projects/${p.id}/ads/sync`, { method: "POST" })).body.error, /Connect Google Ads first/);
      const v = (await a(`/projects/${p.id}/ads`)).body;
      assert.deepEqual(v.setup, { developerToken: false, connected: false, accountChosen: false, canAllowWrites: true });
    });

    await check("deleting a client needs a confirm, and then it is gone", async () => {
      assert.match((await a(`/projects/${p.id}/delete`, { method: "POST", body: {} })).body.error, /Confirm/);
      assert.equal((await a(`/projects/${p.id}/delete`, { method: "POST", body: { confirm: true } })).status, 200);
      assert.equal((await a("/projects")).body.projects.length, 0);
    });
  } finally {
    await s.stop();
  }
}

console.log(`server: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
