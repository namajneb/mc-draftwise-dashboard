# mc-draftwise-dashboard

Vite + React dashboard for Draftwise, deployed on Vercel. Data comes from three
serverless proxies in `api/` (LinkedIn Ads, Google Ads, HeyReach) so that API
credentials never reach the browser.

## LinkedIn authentication

LinkedIn access tokens expire after **60 days**. A single pasted
`LINKEDIN_TOKEN` therefore breaks the dashboard every two months.

`api/linkedin.js` prefers a refresh-token flow. Set these in Vercel
(Project → Settings → Environment Variables) and redeploy:

| Variable | Where it comes from |
| --- | --- |
| `LINKEDIN_CLIENT_ID` | LinkedIn developer app → Auth tab |
| `LINKEDIN_CLIENT_SECRET` | LinkedIn developer app → Auth tab |
| `LINKEDIN_REFRESH_TOKEN` | Authorization Code flow (below) |

Refresh tokens are valid for **365 days** and LinkedIn does *not* extend that
clock when one is used, so there is nothing to persist between invocations —
but the app must be re-authorized once a year.

Programmatic refresh tokens are only issued to apps approved for the Marketing
Developer Platform. If the app is not approved, leave `LINKEDIN_TOKEN` set; the
proxy falls back to it and reports a clear error when it expires.

### Getting a refresh token

Run the helper — it does the whole OAuth flow locally (opens the consent page,
catches the redirect on `127.0.0.1`, exchanges the code) and prints the three
variables ready to paste:

```sh
node scripts/mint-linkedin-refresh-token.mjs
```

One prerequisite, at https://developer.linkedin.com/ → My Apps → your app:

- **Auth tab → Authorized redirect URLs** must contain exactly
  `http://127.0.0.1:4572/`. LinkedIn requires an exact match and, unlike Google,
  will not accept an arbitrary loopback port. Without it the consent page fails
  before you can approve.
- **Products tab** must include **Advertising API** (that grants `r_ads` and
  `r_ads_reporting`). Requesting a scope the app lacks fails with
  `unauthorized_scope_error`.

The script then lists every ad account the new credential can see and flags
whether Draftwise (`513153545`) is among them. This matters because a token
minted from the wrong LinkedIn app, or approved by a member without access to
that account, authorizes cleanly and *then* renders an empty dashboard.

If the output shows `LINKEDIN_TOKEN=` instead of `LINKEDIN_REFRESH_TOKEN=`,
LinkedIn issued no refresh token — the app is not enabled for them. Set that
single value instead and expect to repeat this every 60 days, or ask LinkedIn
to enable programmatic refresh tokens on the app.

Note that a status of `REMOVED` on an ad account is not the same as absent:
deleting a LinkedIn ad account only marks it removed, and it keeps appearing in
listings.

## Google Ads

`api/google-ads.js` already refreshes its own tokens. It needs
`GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`,
`GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, and
`GOOGLE_ADS_MANAGER_ID`.

## Local development

```sh
npm install
npm run dev     # front end only; /api/* needs `vercel dev`
npm run build
```
