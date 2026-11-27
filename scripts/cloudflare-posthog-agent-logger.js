/**
 * Cloudflare Worker: Headless LLM / AI Agent Access Logger -> PostHog
 *
 * Why this exists:
 * Client-side JavaScript in site.js tracks human visitors (including human clicks
 * arriving from ChatGPT, Perplexity, Claude, and Gemini). However, LLM crawlers
 * and RAG agents fetch /llms.txt, /llms-full.txt, and /articles/*.md over raw HTTP
 * without executing JavaScript, and GitHub Pages does not expose server access logs.
 *
 * Deployment (optional, if behaviorized.net is proxied through Cloudflare):
 * 1. Create a Cloudflare Worker on route `behaviorized.net/*`.
 * 2. Set Worker secret `POSTHOG_PROJECT_KEY` (your `phc_...` project key)
 *    and optional variable `POSTHOG_HOST` (defaults to `https://us.i.posthog.com`).
 * 3. Every request passes straight through to origin with zero added latency;
 *    agent/Markdown fetches are logged asynchronously via `ctx.waitUntil`.
 */

const AGENT_PATTERNS = [
  ["gptbot", /GPTBot/i],
  ["oai_searchbot", /OAI-SearchBot/i],
  ["chatgpt_user", /ChatGPT-User/i],
  ["claudebot", /ClaudeBot/i],
  ["claude_web", /Claude-Web|Claude-User/i],
  ["claude_searchbot", /Claude-SearchBot/i],
  ["perplexitybot", /PerplexityBot/i],
  ["perplexity_user", /Perplexity-User/i],
  ["google_extended", /Google-Extended/i],
  ["googlebot", /Googlebot/i],
  ["applebot_extended", /Applebot-Extended/i],
  ["bingbot", /bingbot/i],
  ["duckassistbot", /DuckAssistBot/i],
  ["meta_external", /Meta-ExternalAgent|facebookexternalhit/i],
  ["amazonbot", /Amazonbot/i],
  ["mistral_user", /MistralAI-User/i],
  ["cohere_ai", /cohere-ai/i],
  ["youbot", /YouBot/i],
  ["programmatic_http", /python-requests|httpx|aiohttp|curl\/|Go-http-client|node-fetch|undici/i],
];

function detectAgent(ua) {
  if (!ua) return null;
  for (const [name, rx] of AGENT_PATTERNS) {
    if (rx.test(ua)) return name;
  }
  return null;
}

function classifyResource(pathname) {
  if (pathname === "/llms.txt") return "llms_index";
  if (pathname === "/llms-full.txt") return "llms_full_corpus";
  if (pathname.endsWith(".md")) return "article_markdown";
  if (pathname === "/sitemap.xml" || pathname === "/robots.txt") return "discovery_meta";
  if (pathname.startsWith("/articles/")) return "article_html";
  if (pathname.startsWith("/blog/")) return "blog_redirect";
  return "site_page";
}

export default {
  async fetch(request, env, ctx) {
    const response = await fetch(request);

    const apiKey = (env && env.POSTHOG_PROJECT_KEY) || "phc_A5YwXFx7y2meb2VhefKbsYpkeTStRrJMXEz7zfrWAdvt";
    if (!apiKey || request.method !== "GET") {
      return response;
    }

    const url = new URL(request.url);
    const ua = request.headers.get("user-agent") || "";
    const agentFamily = detectAgent(ua);
    const resourceKind = classifyResource(url.pathname);
    const isAgentResource =
      resourceKind === "llms_index" ||
      resourceKind === "llms_full_corpus" ||
      resourceKind === "article_markdown";

    if (!agentFamily && !isAgentResource) {
      return response;
    }

    const host = (env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/+$/, "");
    const slugMatch = url.pathname.match(/\/(?:articles|blog)\/([^/.]+)/);

    const payload = {
      api_key: apiKey,
      event: "llm_agent_request",
      distinct_id: `edge_agent_${agentFamily || "unknown_markdown_reader"}`,
      properties: {
        $process_person_profile: false,
        path: url.pathname,
        resource_kind: resourceKind,
        article_slug: slugMatch ? slugMatch[1] : null,
        agent_family: agentFamily || "unlabelled_client",
        user_agent: ua.slice(0, 300),
        status_code: response.status,
        country: (request.cf && request.cf.country) || null,
      },
    };

    ctx.waitUntil(
      fetch(`${host}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {})
    );

    return response;
  },
};
