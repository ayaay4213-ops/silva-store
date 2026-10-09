/**
 * Silva Auto Save Gateway
 * Saves products.json and site-settings.json
 * to ayaay4213-ops/silva-store on GitHub.
 *
 * Required secret:
 *   GITHUB_TOKEN
 *
 * Optional variable:
 *   ALLOWED_ORIGIN=https://ayaay4213-ops.github.io
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

function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed =
      env.ALLOWED_ORIGIN ||
      "https://ayaay4213-ops.github.io";

    const headers = {
      ...cors(origin, allowed),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    };

    if (origin !== allowed) {
      return json(
        { error: "Origin not allowed" },
        403,
        headers
      );
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers
      });
    }

    if (request.method !== "POST") {
      return json(
        { error: "Use POST to save store data" },
        405,
        headers
      );
    }

    if (!env.GITHUB_TOKEN) {
      return json(
        { error: "GITHUB_TOKEN secret is not configured" },
        503,
        headers
      );
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json(
        { error: "Invalid JSON request" },
        400,
        headers
      );
    }

    const path = String(body.path || "");
    const content = body.content;
    const message = String(
      body.message || "Update Silva store data"
    ).slice(0, 120);

    const allowedFiles = [
      "products.json",
      "site-settings.json"
    ];

    if (!allowedFiles.includes(path)) {
      return json(
        { error: "File path is not allowed" },
        400,
        headers
      );
    }

    if (
      typeof content !== "string" ||
      content.length > 1500000
    ) {
      return json(
        { error: "Content must be text under 1.5 MB" },
        413,
        headers
      );
    }

    try {
      JSON.parse(content);
    } catch {
      return json(
        { error: "File content must be valid JSON" },
        400,
        headers
      );
    }

    const fileUrl =
      `${API}/repos/${OWNER}/${REPO}/contents/${path}`;

    const githubHeaders = {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Silva-Store-Save-Gateway",
      "Content-Type": "application/json"
    };

    try {
      const current = await fetch(
        `${fileUrl}?ref=${BRANCH}`,
        { headers: githubHeaders }
      );

      let sha;

      if (current.ok) {
        const data = await current.json();
        sha = data.sha;
      } else if (current.status !== 404) {
        const detail = await current.text();

        return json(
          {
            error: "Could not read current GitHub file",
            detail: detail.slice(0, 400)
          },
          502,
          headers
        );
      }

      const payload = {
        message,
        content: btoa(
          unescape(encodeURIComponent(content))
        ),
        branch: BRANCH
      };

      if (sha) {
        payload.sha = sha;
      }

      const saved = await fetch(fileUrl, {
        method: "PUT",
        headers: githubHeaders,
        body: JSON.stringify(payload)
      });

      const resultText = await saved.text();

      if (!saved.ok) {
        return json(
          {
            error: "GitHub save failed",
            detail: resultText.slice(0, 600)
          },
          502,
          headers
        );
      }

      const result = JSON.parse(resultText);

      return json(
        {
          ok: true,
          path,
          commit: result.commit?.sha || null,
          message:
            "Saved to GitHub. The live site may take a few minutes to update."
        },
        200,
        headers
      );
    } catch (error) {
      return json(
        {
          error: "Save request failed",
          detail: String(error).slice(0, 300)
        },
        500,
        headers
      );
    }
  }
};
