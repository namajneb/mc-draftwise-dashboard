module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.LINKEDIN_TOKEN;
  if (!token) return res.status(500).json({ error: "LINKEDIN_TOKEN not configured" });

  try {
    const liPath = req.query.path;
    if (!liPath) return res.status(400).json({ error: "Missing path param" });

    const liUrl = `https://api.linkedin.com${liPath}`;
    const headers = { Authorization: `Bearer ${token}` };
    if (liPath.includes("/adAnalyticsV2") || liPath.startsWith("/rest/")) {
      headers["X-Restli-Protocol-Version"] = "2.0.0";
    }
    if (liPath.startsWith("/rest/")) headers["LinkedIn-Version"] = "202601";
    const upstream = await fetch(liUrl, { headers });

    const data = await upstream.json();
    if (!upstream.ok) {
      data._debugUrl  = liUrl;
      data._parsedUrl = new URL(liUrl).href;
    }
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
