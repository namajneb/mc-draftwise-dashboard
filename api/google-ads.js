// Vercel serverless proxy — Google Ads API requires server-side OAuth + developer token
// Credentials live in Vercel env vars; tokens are refreshed automatically.

let _accessToken = null;
let _tokenExpiry  = 0;

async function fetchJson(url, options) {
  const res  = await fetch(url, options);
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    throw new Error(`Non-JSON response from ${url.split("?")[0]} (${res.status}): ${text.slice(0, 120)}`);
  }
}

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken;
  const { data } = await fetchJson("https://oauth2.googleapis.com/token", {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    }).toString(),
  });
  if (!data.access_token) throw new Error(`Token error: ${data.error} — ${data.error_description}`);
  _accessToken = data.access_token;
  _tokenExpiry  = Date.now() + (data.expires_in - 60) * 1000;
  return _accessToken;
}

function sendJson(res, status, body) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

const REQUIRED_ENV = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_MANAGER_ID",
];

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.statusCode = 200;
    res.end();
    return;
  }

  try {
    const missing = REQUIRED_ENV.filter(k => !process.env[k]);
    if (missing.length) {
      return sendJson(res, 500, { _setupRequired: true, missing });
    }

    const accessToken = await getAccessToken();
    const managerId   = process.env.GOOGLE_ADS_MANAGER_ID.replace(/-/g, "");
    const devToken    = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

    const headers = {
      Authorization:       `Bearer ${accessToken}`,
      "developer-token":   devToken,
      "Content-Type":      "application/json",
      "login-customer-id": managerId,
    };

    if (req.query.action === "accounts") {
      // Query child accounts directly from the manager account via GAQL
      const { status: listStatus, data: listData } = await fetchJson(
        `https://googleads.googleapis.com/v24/customers/${managerId}/googleAds:search`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: `SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.status
                    FROM customer_client
                    WHERE customer_client.status = 'ENABLED' AND customer_client.manager = false`,
          }),
        }
      );
      if (listStatus !== 200) return sendJson(res, listStatus, listData);
      const rows = listData.results || [];
      const customers = rows.map(r => ({
        id:   String(r.customerClient.id),
        name: r.customerClient.descriptiveName || `Account ${r.customerClient.id}`,
      }));
      return sendJson(res, 200, { customers });
    }

    const customerId = (req.query.customerId || "").replace(/-/g, "");
    const query      = req.query.q ? decodeURIComponent(req.query.q) : null;
    if (!customerId || !query) return sendJson(res, 400, { error: "Missing customerId or q" });

    const { status, data } = await fetchJson(
      `https://googleads.googleapis.com/v24/customers/${customerId}/googleAds:search`,
      { method: "POST", headers, body: JSON.stringify({ query }) }
    );
    if (status !== 200) console.error("[google-ads] API error", status, JSON.stringify(data));
    sendJson(res, status, data);

  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
};
