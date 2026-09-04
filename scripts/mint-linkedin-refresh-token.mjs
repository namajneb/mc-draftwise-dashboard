#!/usr/bin/env node
// Mints a LinkedIn refresh token (and access token) for this app.
//
//   node scripts/mint-linkedin-refresh-token.mjs
//
// Runs the 3-legged OAuth flow locally: opens a consent page, catches the redirect on
// 127.0.0.1, exchanges the code, and prints the credentials. Nothing is stored or
// transmitted anywhere except LinkedIn.
//
// Why this exists: LinkedIn access tokens expire after 60 days. api/linkedin.js can
// auto-refresh — but only if LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET and
// LINKEDIN_REFRESH_TOKEN are set. Without them it falls back to a hand-pasted
// LINKEDIN_TOKEN, which lapses every two months and takes the dashboard down.
//
// After minting, this verifies the credential can actually see the Draftwise ad
// account AND can read post content — a token for the wrong LinkedIn app or member,
// or one missing the organic scopes, authorizes fine and then returns empty
// dashboards or blank creative images, which is confusing to debug later.
//
// Prerequisites at https://developer.linkedin.com/ → My Apps → your app:
//   1. Auth tab → "Authorized redirect URLs" → add EXACTLY:  http://127.0.0.1:4572/
//      LinkedIn requires an exact match and, unlike Google, does not accept arbitrary
//      loopback ports. If this is missing the consent page fails before you can approve.
//   2. Products tab → the app must already have the products granting the scopes below.
//      Requesting a scope the app lacks fails with "unauthorized_scope_error":
//        ads     → Advertising API
//        organic → Community Management API
//   3. You must be an admin of the app and of the Company Pages involved.

import { createServer } from "node:http";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, exit } from "node:process";
import { randomBytes } from "node:crypto";

const PORT = 4572;
const REDIRECT = `http://127.0.0.1:${PORT}/`;

const SCOPE_SETS = {
  ads: {
    label: "Ads reporting only (restores the LinkedIn Ads dashboard)",
    scopes: ["r_ads", "r_ads_reporting"],
    product: "Advertising API",
  },
  organic: {
    label: "Organic page data only (followers, posts)",
    scopes: ["r_organization_social", "rw_organization_admin"],
    product: "Community Management API",
  },
  both: {
    label: "Ads + organic (one credential for both)",
    scopes: ["r_ads", "r_ads_reporting", "r_organization_social", "rw_organization_admin"],
    product: "Advertising API + Community Management API",
  },
};

const b64url = buf => buf.toString("base64")
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function main() {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log("\nLinkedIn refresh token helper\n");
  console.log(`Redirect URL that must be registered on the app:  ${REDIRECT}\n`);
  // Ads scopes alone are NOT enough. Creative thumbnails come from the post behind
  // each ad — /v2/ugcPosts and /v2/shares — which return 403 ACCESS_DENIED without
  // r_organization_social. A token minted with only r_ads/r_ads_reporting loads the
  // dashboard with every metric intact and every image blank, which reads as a broken
  // renderer rather than a missing permission. Verified 2026-09-04.
  const chosen = SCOPE_SETS.both;
  console.log(`Scopes: ${chosen.scopes.join(" ")}`);
  console.log(`Requires: ${chosen.product}\n`);

  const clientId = (await rl.question("Client ID: ")).trim();
  const clientSecret = (await rl.question("Client Secret: ")).trim();
  rl.close();
  if (!clientId || !clientSecret) { console.error("Both client id and secret are required."); exit(1); }

  // LinkedIn's 3-legged flow ignores PKCE, so `state` is the only CSRF guard here.
  const state = b64url(randomBytes(16));

  const authUrl = "https://www.linkedin.com/oauth/v2/authorization?" + new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: chosen.scopes.join(" "),
    state,
  }).toString();

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, REDIRECT);
      if (url.pathname !== "/") { res.writeHead(404).end(); return; }

      const err = url.searchParams.get("error");
      const errDesc = url.searchParams.get("error_description");
      const got = url.searchParams.get("code");
      const gotState = url.searchParams.get("state");

      const done = msg => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8">
          <body style="font:15px/1.6 -apple-system,system-ui,sans-serif;background:#0c0c0c;color:#f0f2f5;
                       display:grid;place-items:center;height:100vh;margin:0">
            <div style="text-align:center"><p>${msg}</p>
            <p style="color:#666;font-size:13px">You can close this tab and return to the terminal.</p></div>
          </body>`);
      };

      if (err)                     { done(`Authorisation failed: ${err}`); server.close(); reject(new Error(errDesc ? `${err}: ${errDesc}` : err)); }
      else if (gotState !== state) { done("State mismatch — aborted."); server.close(); reject(new Error("State mismatch")); }
      else if (!got)               { done("No code returned."); server.close(); reject(new Error("No code")); }
      else                         { done("Authorised."); server.close(); resolve(got); }
    });

    server.listen(PORT, "127.0.0.1", async () => {
      console.log(`\nListening on ${REDIRECT}`);
      console.log("\nOpen this URL and approve access:\n");
      console.log(authUrl + "\n");
      // Best effort — the URL is printed above regardless.
      try {
        const { spawn } = await import("node:child_process");
        const opener = process.platform === "darwin" ? "open"
                     : process.platform === "win32" ? "start" : "xdg-open";
        spawn(opener, [authUrl], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
      } catch { /* print-only is fine */ }
    });

    server.on("error", e => reject(
      e.code === "EADDRINUSE"
        ? new Error(`Port ${PORT} is already in use — close whatever holds it and retry.`)
        : e
    ));
    setTimeout(() => { server.close(); reject(new Error("Timed out after 5 minutes")); }, 5 * 60_000);
  });

  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT,
    }).toString(),
  });
  const tok = await res.json();

  if (!res.ok || !tok.access_token) {
    console.error("\nToken exchange failed:");
    console.error(JSON.stringify(tok, null, 2));
    exit(1);
  }

  const days = n => n ? `${Math.round(n / 86400)} days` : "unknown";

  console.log("\n" + "─".repeat(70));
  console.log("Add these to Vercel (Project → Settings → Environment Variables):\n");
  console.log(`LINKEDIN_CLIENT_ID=${clientId}`);
  console.log(`LINKEDIN_CLIENT_SECRET=${clientSecret}`);

  if (tok.refresh_token) {
    console.log(`LINKEDIN_REFRESH_TOKEN=${tok.refresh_token}`);
    console.log("\n" + "─".repeat(70));
    console.log(`access token expires in:   ${days(tok.expires_in)}`);
    console.log(`refresh token expires in:  ${days(tok.refresh_token_expires_in)}`);
    console.log("\nWith all three set, api/linkedin-auth.js refreshes on its own and this");
    console.log("stops being a recurring chore until the refresh token itself expires.");
  } else {
    // Refresh tokens are only issued to apps LinkedIn has enabled for them. Without one,
    // the 60-day access token is the only option and this has to be redone by hand.
    console.log(`LINKEDIN_TOKEN=${tok.access_token}`);
    console.log("\n" + "─".repeat(70));
    console.log(`access token expires in: ${days(tok.expires_in)}`);
    console.log("\nLinkedIn returned NO refresh token — this app is not enabled for them, so");
    console.log("the 60-day access token above is the only credential available. Set a");
    console.log("reminder to re-run this before it lapses, or ask LinkedIn to enable");
    console.log("refresh tokens on the app to make it self-sustaining.");
  }

  await verifyAccountAccess(tok.access_token);

  console.log("\nThen redeploy. The dashboard reads these on the next request —");
  console.log("no code change needed.\n");
}

// The dashboard is hardcoded to one ad account, so "authorized" is not the same as
// "working": a token minted from a different app, or approved by a member without
// access, sails through consent and then shows nothing.
const DRAFTWISE_ACCOUNT_ID = "513153545";

async function verifyAccountAccess(accessToken) {
  console.log("\n" + "─".repeat(70));
  console.log("Checking which ad accounts this credential can see…\n");

  let res, data;
  try {
    res = await fetch(
      "https://api.linkedin.com/v2/adAccountsV2?q=search&count=100&fields=id,name,status",
      { headers: { Authorization: `Bearer ${accessToken}`, "X-Restli-Protocol-Version": "2.0.0" } }
    );
    data = await res.json();
  } catch (err) {
    console.log(`  Could not reach LinkedIn to verify (${err.message}).`);
    console.log("  The credentials above are still valid — verify by loading the dashboard.");
    return;
  }

  if (!res.ok) {
    console.log(`  Verification call failed (${res.status}): ${data.message || JSON.stringify(data)}`);
    if (res.status === 403) {
      console.log("  A 403 here usually means the app lacks the Advertising API product.");
    }
    return;
  }

  const accounts = data.elements || [];
  if (!accounts.length) {
    console.log("  This credential can see NO ad accounts. The app or the approving");
    console.log("  member does not have access to any — the dashboard will load empty.");
    return;
  }

  for (const a of accounts) {
    const mark = String(a.id) === DRAFTWISE_ACCOUNT_ID ? "->" : "  ";
    console.log(`  ${mark} ${a.id}  ${a.name || "(unnamed)"}  [${a.status || "?"}]`);
  }

  const found = accounts.find(a => String(a.id) === DRAFTWISE_ACCOUNT_ID);
  console.log("");
  await verifyPostAccess(accessToken);
  if (!found) {
    console.log(`  WARNING: Draftwise (${DRAFTWISE_ACCOUNT_ID}) is NOT in that list.`);
    console.log("  These credentials will authorize but the dashboard will stay empty.");
    console.log("  Re-run using the LinkedIn app that owns the Draftwise ad account,");
    console.log("  and approve as a member with access to it.");
  } else if (found.status && found.status !== "ACTIVE") {
    console.log(`  Draftwise (${DRAFTWISE_ACCOUNT_ID}) is visible but status is ${found.status}.`);
  } else {
    console.log(`  Draftwise (${DRAFTWISE_ACCOUNT_ID}) is visible. These credentials will work.`);
  }
}

main().catch(err => { console.error(`\n${err.message}`); exit(1); });

// Ads scopes are the easy half to get right; the organic scope is the one whose
// absence is invisible until someone notices the thumbnails are blank.
async function verifyPostAccess(accessToken) {
  let res;
  try {
    res = await fetch("https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(urn%3Ali%3Aorganization%3A0)&count=1",
      { headers: { Authorization: `Bearer ${accessToken}`, "X-Restli-Protocol-Version": "2.0.0" } });
  } catch {
    console.log("  Could not check post access; creative images may or may not load.");
    return;
  }
  // A missing scope is 403 regardless of whether org 0 exists, so the status
  // separates "not allowed" from "allowed but no such organization".
  if (res.status === 403) {
    console.log("  WARNING: this token cannot read post content (403 on ugcPosts), so ad");
    console.log("  creative thumbnails will be blank. The app needs r_organization_social");
    console.log("  via the Community Management API product.");
  } else {
    console.log("  Post content is readable — creative thumbnails will load.");
  }
}
