/**
 * Silva secure save gateway for Cloudflare Workers.
 *
 * Required Worker secrets/variables:
 *   GITHUB_TOKEN (secret): fine-grained token scoped only to ayaay4213-ops/silva-store
 *     with Contents: Read and write.
 *   ALLOWED_ORIGIN (variable): https://ayaay4213-ops.github.io
 *
 * Deploy this file as a Cloudflare Worker before connecting the dashboard to it.
 * Never place GITHUB_TOKEN in index.html or any public file.
 */
const OWNER = "ayaay4213-ops";
const REPO = "silva-store";
const BRANCH = "main";
const API = "https://api.github.com";

function cors(origin, allowed) {
  if (origin !== allowed) return {};
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGIN || "https://ayaay4213-ops.github.io";
    const headers = {
      ...cors(origin, allowed),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    };

    if (request.method === "OPTIONS") {
      if (origin !== allowed) return new Response("Forbidden", { status: 403 });
      return new Response(null, { status: 204, headers });
    }
    if (origin !== allowed) return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers });
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "Use POST" }), { status: 405, headers });
    if (!env.GITHUB_TOKEN) return new Response(JSON.stringify({ error: "Worker secret GITHUB_TOKEN is not configured" }), { status: 503, headers });

    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers }); }

    const path = String(body.path || "");
    const content = body.content;
    const message = String(body.message || "Update Silva store data").slice(0, 120);

    // Only permit the two data files. Image uploads should be implemented separately.
    if (!["products.json", "site-settings.json"].includes(path)) {
      return new Response(JSON.stringify({ error: "This path cannot be changed by the dashboard" }), { status: 400, headers });
    }
    if (typeof content !== "string" || content.length > 1_500_000) {
      return new Response(JSON.stringify({ error: "Content must be text and under 1.5 MB" }), { status: 413, headers });
    }
    try {
      JSON.parse(content);
    } catch {
      return new Response(JSON.stringify({ error: "The file content must be valid JSON" }), { status: 400, headers });
    }

    const fileUrl = API + "/repos/" + OWNER + "/" + REPO + "/contents/" + path;
    const ghHeaders = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Silva-Store-Save-Gateway",
      "Content-Type": "application/json"
    };

    try {
      const current = await fetch(fileUrl + "?ref=" + BRANCH, { headers: ghHeaders });
      let sha;
      if (current.ok) {
        const data = await current.json();
        sha = data.sha;
      } else if (current.status !== 404) {
        const detail = await current.text();
        return new Response(JSON.stringify({ error: "GitHub read failed", detail: detail.slice(0, 400) }), { status: 502, headers });
      }

      const payload = {
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: BRANCH
      };
      if (sha) payload.sha = sha;

      const saved = await fetch(fileUrl, { method: "PUT", headers: ghHeaders, body: JSON.stringify(payload) });
      const resultText = await saved.text();
      if (!saved.ok) return new Response(JSON.stringify({ error: "GitHub save failed", detail: resultText.slice(0, 600) }), { status: 502, headers });
      const result = JSON.parse(resultText);
      return new Response(JSON.stringify({
        ok: true,
        path,
        commit: result.commit && result.commit.sha,
        message: "Saved to GitHub. GitHub Pages may take a few minutes to update."
      }), { status: 200, headers });
    } catch (error) {
      return new Response(JSON.stringify({ error: "Save request failed", detail: String(error).slice(0, 300) }), { status: 500, headers });
    }
  }
};
