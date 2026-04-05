import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";

const rootDir = process.cwd();
const basePath = `/${path.basename(rootDir)}`;
const port = Number(process.env.PORT || 3000);
const badgeOverride = `
<style>
.buy-badge,
.w-webflow-badge {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
</style>
<script>
(() => {
  const selectors = [".buy-badge", ".w-webflow-badge"];
  const removeBadges = () => {
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => node.remove());
    }
  };

  removeBadges();
  document.addEventListener("DOMContentLoaded", removeBadges);
  window.addEventListener("load", removeBadges);
  new MutationObserver(removeBadges).observe(document.documentElement, { childList: true, subtree: true });
})();
</script>
`;

function resolveFilePath(urlPath) {
  const pathname = urlPath.split("?")[0];
  const decodedPathname = (() => {
    try {
      return decodeURIComponent(pathname);
    } catch {
      return pathname;
    }
  })();
  const normalized = decodedPathname === "/" ? "/index.html" : decodedPathname;
  return path.join(rootDir, normalized);
}

async function findExistingPath(urlPath) {
  const direct = resolveFilePath(urlPath);
  const candidates = [direct];

  if (!path.extname(direct)) {
    candidates.push(path.join(direct, "index.html"));
    candidates.push(`${direct}.html`);
  }

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return candidate;
      }
    } catch {}
  }

  return null;
}

function stripBasePath(requestUrl) {
  if (requestUrl === basePath || requestUrl === `${basePath}/`) {
    return "/";
  }

  if (requestUrl.startsWith(`${basePath}/`)) {
    return requestUrl.slice(basePath.length) || "/";
  }

  return requestUrl;
}

const server = http.createServer(async (req, res) => {
  const requestUrl = req.url || "/";

  // Strip /city prefix if present (HTML references use /city/assets/...)
  const normalizedUrl = stripBasePath(requestUrl);

  if (normalizedUrl.startsWith("/.wf_graphql/csrf")) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ csrf: "local" }));
    return;
  }

  if (normalizedUrl.startsWith("/.wf_graphql")) {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ data: {} }));
    return;
  }

  const filePath = await findExistingPath(normalizedUrl);
  if (!filePath) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const content = await fs.readFile(filePath);
  const contentType = mime.lookup(filePath) || "application/octet-stream";

  if (contentType === "text/html") {
    const html = content.toString("utf8").replace("</head>", `${badgeOverride}</head>`);
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  res.writeHead(200, { "content-type": contentType });
  res.end(content);
});

server.listen(port, () => {
  console.log(`Local site is running at http://localhost:${port}`);
});
