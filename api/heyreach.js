module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.HEYREACH_API_KEY;
  if (!token) return res.status(500).json({ error: "HEYREACH_API_KEY not configured" });

  try {
    const path = req.query.path;
    if (!path) return res.status(400).json({ error: "Missing path param" });

    // internal=1 targets /api/ (internal ABP endpoints); default targets /api/public/
    const base = req.query.internal === "1"
      ? "https://api.heyreach.io/api"
      : "https://api.heyreach.io/api/public";
    const url = `${base}${path}`;
    const upstream = await fetch(url, {
      method: req.method === "GET" ? "GET" : "POST",
      headers: { "X-API-KEY": token, "Content-Type": "application/json" },
      body: req.method !== "GET" ? JSON.stringify(req.body || {}) : undefined,
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
