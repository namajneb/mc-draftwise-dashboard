// Vercel serverless proxy for the LinkedIn Marketing API.
//
// LinkedIn access tokens live 60 days, so a hardcoded LINKEDIN_TOKEN silently
// dies every two months. When refresh credentials are configured we mint access
// tokens on demand instead (refresh tokens last 365 days). Note that LinkedIn
// does NOT extend the refresh token's TTL when it is used — it stays on its
// original 365-day clock — so there is nothing to persist and a stateless
// function is fine. After a year a human must re-authorize the app.

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";

// Cached across warm invocations of the same lambda.
let _accessToken = null;
let _tokenExpiry = 0;

const hasRefreshCreds = () =>
  Boolean(
    process.env.LINKEDIN_CLIENT_ID &&
    process.env.LINKEDIN_CLIENT_SECRET &&
    process.env.LINKEDIN_REFRESH_TOKEN
  );

async function refreshAccessToken() {
  const res = await fetch(TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: process.env.LINKEDIN_REFRESH_TOKEN,
      client_id:     process.env.LINKEDIN_CLIENT_ID,
      client_secret: process.env.LINKEDIN_CLIENT_SECRET,
    }).toString(),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AuthError(
      `LinkedIn returned a non-JSON token response (${res.status})`,
      { reauthRequired: false }
    );
  }

  if (!res.ok || !data.access_token) {
    // invalid_request here almost always means the refresh token is expired,
    // revoked, or the app was never approved for programmatic refresh tokens.
    throw new AuthError(
      data.error_description || data.error || `Token refresh failed (${res.status})`,
      { reauthRequired: true }
    );
  }

  _accessToken = data.access_token;
  // Refresh a minute early so we never hand out a token mid-expiry.
  _tokenExpiry = Date.now() + Math.max(0, (data.expires_in || 0) - 60) * 1000;
  return _accessToken;
}

async function getAccessToken() {
  if (hasRefreshCreds()) {
    if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;
    return refreshAccessToken();
  }
  // Legacy path: a manually pasted 60-day token.
  if (process.env.LINKEDIN_TOKEN) return process.env.LINKEDIN_TOKEN;
  return null;
}

class AuthError extends Error {
  constructor(message, { reauthRequired = false } = {}) {
    super(message);
    this.reauthRequired = reauthRequired;
  }
}

async function callLinkedIn(liPath, token) {
  const liUrl   = `https://api.linkedin.com${liPath}`;
  const headers = { Authorization: `Bearer ${token}` };

  if (liPath.includes("/adAnalyticsV2") || liPath.startsWith("/rest/")) {
    headers["X-Restli-Protocol-Version"] = "2.0.0";
  }
  if (liPath.startsWith("/rest/")) headers["LinkedIn-Version"] = "202601";

  const upstream = await fetch(liUrl, { headers });
  const text     = await upstream.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { message: text.slice(0, 300) };
  }
  return { status: upstream.status, data, url: liUrl };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const liPath = req.query.path;
  if (!liPath) return res.status(400).json({ error: "Missing path param" });

  try {
    let token = await getAccessToken();
    if (!token) {
      return res.status(500).json({
        _setupRequired: true,
        error: "LinkedIn is not connected.",
        missing: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET", "LINKEDIN_REFRESH_TOKEN"],
      });
    }

    let { status, data, url } = await callLinkedIn(liPath, token);

    // A cached access token can expire mid-lifetime if LinkedIn revokes it.
    // Bust the cache and retry once before surfacing the failure.
    if (status === 401 && hasRefreshCreds()) {
      _accessToken = null;
      _tokenExpiry = 0;
      token = await getAccessToken();
      ({ status, data, url } = await callLinkedIn(liPath, token));
    }

    if (status === 401) {
      return res.status(401).json({
        _authExpired: true,
        // Either way a human has to act: paste a fresh token, or re-authorize
        // the app so a new refresh token is issued.
        _reauthRequired: true,
        error: hasRefreshCreds()
          ? "LinkedIn rejected the access token even after refreshing it. The app may need to be re-authorized."
          : "The LinkedIn access token has expired. LinkedIn tokens last 60 days; configure refresh credentials so this renews automatically.",
        upstream: data,
      });
    }

    if (status < 200 || status >= 300) {
      data._debugUrl = url;
    }
    return res.status(status).json(data);

  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(401).json({
        _authExpired:    true,
        _reauthRequired: err.reauthRequired,
        error: err.reauthRequired
          ? `LinkedIn refresh token is invalid or expired — the app must be re-authorized. (${err.message})`
          : err.message,
      });
    }
    return res.status(500).json({ error: err.message });
  }
};
