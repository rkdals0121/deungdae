// 등대 앱 → GitHub 중계. 토큰은 Vercel 환경변수 GH_TOKEN 에만 있고 브라우저에는 없다.
// 앱이 실제로 쓰는 요청만 통과시킨다: 수신함 파일 4개 읽기, decisions.json 쓰기, 실행 요청 2종.
const REPO = "rkdals0121/notice-watcher";
const READABLE = /^\/contents\/state\/(inbox|decisions|notion_links|config)\.json(\?.*)?$/;
const WRITABLE = /^\/contents\/state\/decisions\.json$/;
const EVENTS = new Set(["inbox_action", "watch_now"]);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Deungdae-Proxy", "1");
  const token = (process.env.GH_TOKEN || "").trim();
  if (!token) return res.status(503).json({ error: "not_configured" });

  // 이 앱 화면에서 보낸 요청만 받는다 (다른 사이트가 끼워 보내는 요청 차단)
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin") return res.status(403).json({ error: "forbidden" });

  const path = String(req.query.p || "");
  const method = req.method;
  let body;
  if (method === "GET" && READABLE.test(path)) {
    body = undefined;
  } else if (method === "PUT" && WRITABLE.test(path)) {
    const b = req.body || {};
    if (typeof b.content !== "string" || b.content.length > 400000) return res.status(400).json({ error: "bad_body" });
    body = JSON.stringify({ message: String(b.message || "decisions").slice(0, 120), content: b.content, sha: b.sha, branch: "main" });
  } else if (method === "POST" && path === "/dispatches") {
    const b = req.body || {};
    if (!EVENTS.has(b.event_type)) return res.status(400).json({ error: "bad_event" });
    const p = b.client_payload || {};
    const payload = b.event_type === "inbox_action"
      ? { id: String(p.id || "").slice(0, 40), action: ["add", "trash", "restore"].includes(p.action) ? p.action : "add" }
      : {};
    body = JSON.stringify({ event_type: b.event_type, client_payload: payload });
  } else {
    return res.status(404).json({ error: "not_allowed" });
  }

  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    body,
    headers: {
      Authorization: "Bearer " + token,
      Accept: req.headers["accept"] && req.headers["accept"].includes("vnd.github") ? req.headers["accept"] : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "deungdae-app",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
  });
  // GitHub 이 토큰을 거부하면 앱이 알아볼 수 있게 구분해 준다
  if (r.status === 401) return res.status(502).json({ error: "server_token_rejected" });
  const text = await r.text();
  res.status(r.status);
  res.setHeader("Content-Type", r.headers.get("content-type") || "application/json");
  return res.send(text);
};
