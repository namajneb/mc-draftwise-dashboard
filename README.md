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

1. Open the authorization URL in a browser, signed in as a user with access to
   the Draftwise ad account:

   ```
   https://www.linkedin.com/oauth/v2/authorization
     ?response_type=code
     &client_id=YOUR_CLIENT_ID
     &redirect_uri=YOUR_REGISTERED_REDIRECT_URI
     &scope=r_ads,r_ads_reporting
   ```

2. Approve, then copy the `code` query param off the redirect URL.
3. Exchange it for tokens (the code is single-use and expires in ~30 seconds):

   ```sh
   curl -X POST https://www.linkedin.com/oauth/v2/accessToken \
     -d grant_type=authorization_code \
     -d code=THE_CODE \
     -d redirect_uri=YOUR_REGISTERED_REDIRECT_URI \
     -d client_id=YOUR_CLIENT_ID \
     -d client_secret=YOUR_CLIENT_SECRET
   ```

4. Store the `refresh_token` from the response as `LINKEDIN_REFRESH_TOKEN`.

If the response has no `refresh_token`, the app is not approved for programmatic
refresh tokens — use the `LINKEDIN_TOKEN` fallback and rotate it manually.

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
