#!/usr/bin/env python3
"""Regenerate everything derived from the article list.

Source of truth: articles/articles.json (one entry per article) plus each
article's HTML. Run after adding or editing an article:

    python3 scripts/build.py          # write files
    python3 scripts/build.py --check  # exit 1 if anything is out of date

Generates:
  - articles/<slug>.md          Markdown copy of each article (for agents)
  - blog/<slug>/index.html      Clean redirect stubs for legacy /blog/<slug> URLs
  - llms.txt                    from scripts/llms.template.txt
  - llms-full.txt               every article's Markdown in one file
  - sitemap.xml
  - the article list in articles/index.html (and its JSON-LD)
  - the featured list on index.html
It also keeps each article's dateModified, Markdown <link>, and site-wide
educational footer disclaimer in sync.
"""

import html
import json
import re
import sys
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://behaviorized.net"
CHECK = "--check" in sys.argv
changed = []

DISCLAIMER = (
    "Reframed is a self-guided wellbeing tool inspired by cognitive behavioural techniques. "
    "It is not a substitute for professional mental healthcare, diagnosis or treatment."
)


def write(path, text):
    path = ROOT / path
    old = path.read_text() if path.exists() else None
    if old != text:
        changed.append(str(path.relative_to(ROOT)))
        if not CHECK:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)


def ensure_footer_disclaimer(src):
    if "footer-disclaimer" in src or '<p class="footer-copy">' not in src:
        return src
    return re.sub(
        r'([ \t]*)(<p class="footer-copy">)',
        rf'\1<p class="footer-disclaimer">{DISCLAIMER}</p>\n\1\2',
        src,
        count=1,
    )


def nice_date(iso):
    d = date.fromisoformat(iso)
    return f"{d.day} {d.strftime('%b %Y')}"


def replace_region(text, name, body, path):
    pattern = re.compile(
        rf"(<!-- build:{name} -->\n)(?:.*?\n)?([ \t]*<!-- /build:{name} -->)", re.S
    )
    if not pattern.search(text):
        sys.exit(f"{path}: missing <!-- build:{name} --> markers")
    return pattern.sub(lambda m: m.group(1) + body + "\n" + m.group(2), text, count=1)


# ── Minimal HTML tree ────────────────────────────────────────────────

VOID = {"br", "img", "hr", "meta", "link", "input", "source", "wbr"}


class Node:
    def __init__(self, tag, attrs, parent=None):
        self.tag, self.attrs, self.parent, self.children = tag, dict(attrs), parent, []

    @property
    def classes(self):
        return (self.attrs.get("class") or "").split()


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = self.cur = Node("root", {})

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_endtag(self, tag):
        n = self.cur
        while n is not self.root and n.tag != tag:
            n = n.parent
        if n is not self.root:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def find(node, pred):
    for c in node.children:
        if isinstance(c, Node):
            if pred(c):
                return c
            hit = find(c, pred)
            if hit:
                return hit
    return None


# ── HTML → Markdown ──────────────────────────────────────────────────


def absolute(href, base):
    if re.match(r"^[a-z]+:", href) or href.startswith("#"):
        return href if not href.startswith("#") else base + href
    if href.startswith("/"):
        return SITE + href
    parts = base.rsplit("/", 1)[0].split("/")
    for seg in href.split("/"):
        if seg == "..":
            parts.pop()
        elif seg not in (".", ""):
            parts.append(seg)
    return "/".join(parts) + ("/" if href.endswith("/") else "")


def inline(node, base):
    out = []
    for c in node.children:
        if isinstance(c, str):
            out.append(re.sub(r"\s+", " ", c))
            continue
        if "sr-only" in c.classes:
            continue
        inner = inline(c, base)
        if c.tag in ("strong", "b"):
            out.append(f"**{inner.strip()}**")
        elif c.tag in ("em", "i"):
            out.append(f"*{inner.strip()}*")
        elif c.tag == "code":
            out.append(f"`{inner.strip()}`")
        elif c.tag == "a":
            out.append(f"[{inner.strip()}]({absolute(c.attrs.get('href', ''), base)})")
        elif c.tag == "br":
            out.append("  \n")
        else:
            out.append(inner)
    return "".join(out)


def text_of(node, base):
    return re.sub(r" +", " ", inline(node, base)).strip()


def table(node, base):
    rows = []
    for tr in iter_tags(node, "tr"):
        rows.append([text_of(td, base).replace("|", "\\|") for td in tr.children
                     if isinstance(td, Node) and td.tag in ("th", "td")])
    # captions are often visually hidden but still describe the table
    cap = find(node, lambda n: n.tag == "caption")
    caption = text_of(cap, base) if cap else None
    if not rows:
        return []
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * len(rows[0])]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    out = []
    if caption:
        out.append(f"*{caption}*")
    out.append("\n".join(lines))
    return out


def iter_tags(node, tag):
    for c in node.children:
        if isinstance(c, Node):
            if c.tag == tag:
                yield c
            else:
                yield from iter_tags(c, tag)


def blocks(node, base):
    out = []
    for c in node.children:
        if isinstance(c, str):
            if c.strip():
                out.append(re.sub(r"\s+", " ", c).strip())
            continue
        cls = c.classes
        if c.tag in ("h1", "h2", "h3", "h4"):
            out.append("#" * int(c.tag[1]) + " " + text_of(c, base))
        elif c.tag == "p":
            t = text_of(c, base)
            if t:
                out.append(t)
        elif c.tag in ("ul", "ol"):
            items = [li for li in c.children if isinstance(li, Node) and li.tag == "li"]
            out.append("\n".join(
                (f"{i}. " if c.tag == "ol" else "- ") + text_of(li, base)
                for i, li in enumerate(items, 1)))
        elif c.tag == "table":
            out += table(c, base)
        elif "summary" in cls:
            label = find(c, lambda n: "label" in n.classes)
            body = find(c, lambda n: n.tag == "p")
            out.append(f"> **{text_of(label, base) if label else 'In short'}:** {text_of(body, base)}")
        elif "thought" in cls:
            label = find(c, lambda n: "label" in n.classes)
            rest = Node("span", {})
            rest.children = [x for x in c.children if x is not label]
            out.append(f"> **{text_of(label, base) if label else 'Thought'}:** {text_of(rest, base)}")
        elif "cluster-box" in cls:
            label = find(c, lambda n: "label" in n.classes)
            intro = find(c, lambda n: "cluster-intro" in n.classes)
            list_node = find(c, lambda n: n.tag in ("ul", "ol"))
            parts = [f"### {text_of(label, base)}" if label else "### Related reading"]
            if intro:
                parts.append(text_of(intro, base))
            if list_node:
                items = [li for li in list_node.children if isinstance(li, Node) and li.tag == "li"]
                parts.append("\n".join(
                    (f"{i}. " if list_node.tag == "ol" else "- ") + text_of(li, base)
                    for i, li in enumerate(items, 1)
                ))
            out.append("\n\n".join(parts))
        elif "stat-row" in cls:
            stats = [s for s in c.children if isinstance(s, Node) and "stat" in s.classes]
            lines = []
            for s in stats:
                num = find(s, lambda n: "stat-num" in n.classes)
                lab = find(s, lambda n: "stat-label" in n.classes)
                lines.append(f"- **{text_of(num, base)}** {text_of(lab, base)}")
            out.append("\n".join(lines))
        elif "support-card" in cls:
            title = find(c, lambda n: "support-card-title" in n.classes)
            desc = find(c, lambda n: "support-card-desc" in n.classes)
            actions = find(c, lambda n: "support-card-actions" in n.classes)
            out.append("---")
            if actions:
                links = [a for a in actions.children if isinstance(a, Node) and a.tag == "a"]
                link_md = " · ".join(
                    f"[{text_of(a, base)}]({absolute(a.attrs.get('href', ''), base)})" for a in links
                )
                out.append(f"**{text_of(title, base)}** {text_of(desc, base)} {link_md}")
            else:
                link = find(c, lambda n: n.tag == "a")
                out.append(f"**{text_of(title, base)}** {text_of(desc, base)} "
                           f"[Download Reframed on the App Store]({link.attrs['href']})")
        elif c.tag in ("script", "style", "svg", "canvas", "nav", "footer"):
            continue
        else:
            out += blocks(c, base)
    return out


def meta(html_text, pattern):
    m = re.search(pattern, html_text)
    return html.unescape(m.group(1)) if m else ""


def article_markdown(entry, html_text):
    url = f"{SITE}/articles/{entry['slug']}.html"
    tree = TreeBuilder()
    tree.feed(html_text)
    body = find(tree.root, lambda n: n.tag == "article" and "prose" in n.classes)
    if body is None:
        sys.exit(f"{entry['slug']}: no <article class=\"prose\">")
    desc = meta(html_text, r'<meta name="description" content="([^"]*)"')
    header = [
        f"# {entry['title']}",
        f"> {desc}",
        "\n".join([
            f"- Canonical URL: {url}",
            f"- Published: {entry['published']}",
            f"- Updated: {entry['modified']}",
            f"- Reading time: {entry['readTime']}",
            "- Author: Hexp Studios, publisher of the Reframed app",
        ]),
    ]
    return "\n\n".join(header + blocks(body, url)) + "\n"


def redirect_stub(target_path, canonical_url, md_url, title):
    esc_title = html.escape(title, quote=False)
    md_link = (
        f'  <link rel="alternate" type="text/markdown" href="{md_url}" title="Markdown version" />\n'
        if md_url else ""
    )
    md_body = f' (<a href="{md_url}">Markdown version</a>)' if md_url else ""
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '  <meta charset="UTF-8" />\n'
        f"  <title>{esc_title} — Reframed</title>\n"
        '  <meta name="robots" content="noindex, follow" />\n'
        f'  <link rel="canonical" href="{canonical_url}" />\n'
        f"{md_link}"
        f'  <meta http-equiv="refresh" content="0; url={target_path}" />\n'
        "  <script>\n"
        '    try { sessionStorage.setItem("reframed_redirect_from", location.pathname); } catch (e) {}\n'
        f'    location.replace("{target_path}" + location.search + location.hash);\n'
        "  </script>\n"
        "</head>\n"
        "<body>\n"
        f'  <p>Redirecting to <a href="{target_path}">{esc_title}</a>{md_body}.</p>\n'
        "</body>\n"
        "</html>\n"
    )


# ── Build ────────────────────────────────────────────────────────────

articles = json.loads((ROOT / "articles/articles.json").read_text())
articles.sort(key=lambda a: a["published"], reverse=True)
md = {}

for a in articles:
    path = ROOT / f"articles/{a['slug']}.html"
    src = path.read_text()
    new = re.sub(r'("dateModified": ")[^"]*(")', rf"\g<1>{a['modified']}\2", src)
    link = f'<link rel="alternate" type="text/markdown" href="{a["slug"]}.md" title="Markdown version" />'
    if 'type="text/markdown"' not in new:
        new = re.sub(r'(\n([ \t]*)<link rel="canonical"[^\n]*)', rf"\1\n\2{link}", new, count=1)
    new = ensure_footer_disclaimer(new)
    write(f"articles/{a['slug']}.html", new)
    md[a["slug"]] = article_markdown(a, new)
    write(f"articles/{a['slug']}.md", md[a["slug"]])

    for legacy in a.get("legacyPaths", []):
        legacy_clean = legacy.strip("/")
        target_rel = f"/articles/{a['slug']}.html"
        canonical = f"{SITE}{target_rel}"
        md_abs = f"{SITE}/articles/{a['slug']}.md"
        stub = redirect_stub(target_rel, canonical, md_abs, a.get("seoTitle") or a["title"])
        write(f"{legacy_clean}/index.html", stub)

# /blog/ index redirect to /articles/
write(
    "blog/index.html",
    redirect_stub("/articles/", f"{SITE}/articles/", f"{SITE}/llms.txt", "Articles"),
)


def listing(entries, indent, prefix, excerpt_key):
    pad = " " * indent
    items = []
    for a in entries:
        exc = a.get(excerpt_key) or a["excerpt"]
        items.append(
            f'{pad}<a class="article-item" href="{prefix}{a["slug"]}.html">\n'
            f'{pad}  <p class="article-meta">{nice_date(a["published"])} · {a["readTime"]}</p>\n'
            f'{pad}  <h3 class="article-title">{html.escape(a["title"], quote=False)}</h3>\n'
            f'{pad}  <p class="article-excerpt">{html.escape(exc, quote=False)}</p>\n'
            f"{pad}</a>"
        )
    return "\n\n".join(items)


# articles/index.html — full list + JSON-LD
idx_path = "articles/index.html"
idx = (ROOT / idx_path).read_text()
idx = replace_region(idx, "articles", listing(articles, 4, "", "excerpt"), idx_path)
jsonld = {
    "@context": "https://schema.org",
    "@graph": [
        {
            "@type": "CollectionPage",
            "@id": f"{SITE}/articles/",
            "url": f"{SITE}/articles/",
            "name": "Reframed articles",
            "description": "Plain-language guides to the CBT techniques Reframed is built on.",
            "inLanguage": "en",
            "isPartOf": {"@type": "WebSite", "name": "Reframed", "url": f"{SITE}/"},
            "publisher": {"@type": "Organization", "name": "Hexp Studios"},
            "mainEntity": {
                "@type": "ItemList",
                "numberOfItems": len(articles),
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": i,
                        "url": f"{SITE}/articles/{a['slug']}.html",
                        "name": a["title"],
                    }
                    for i, a in enumerate(articles, 1)
                ],
            },
        },
        {
            "@type": "BreadcrumbList",
            "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Reframed", "item": f"{SITE}/"},
                {"@type": "ListItem", "position": 2, "name": "Articles", "item": f"{SITE}/articles/"},
            ],
        },
    ],
}
ld = json.dumps(jsonld, indent=2, ensure_ascii=False).replace("\n", "\n  ")
idx = replace_region(
    idx, "jsonld", f'  <script type="application/ld+json">\n  {ld}\n  </script>', idx_path
)
idx = ensure_footer_disclaimer(idx)
write(idx_path, idx)

# index.html — featured list + footer disclaimer
home = (ROOT / "index.html").read_text()
featured = [a for a in articles if a.get("featured")]
home = replace_region(home, "featured", listing(featured, 6, "articles/", "homeExcerpt"), "index.html")
home = ensure_footer_disclaimer(home)
write("index.html", home)

# Ensure footer disclaimer across other top-level static pages
for page_name in ("quiz.html", "self-aware.html", "privacy.html", "terms.html", "support.html", "changelog.html"):
    page_src = (ROOT / page_name).read_text()
    write(page_name, ensure_footer_disclaimer(page_src))

# sitemap.xml
STATIC_TOP = [("", "monthly", "1.0"), ("articles/", "weekly", "0.9")]
STATIC_BOTTOM = [
    ("quiz.html", None, "0.7"),
    ("self-aware.html", None, "0.7"),
    ("support.html", None, "0.4"),
    ("privacy.html", None, "0.4"),
    ("terms.html", None, "0.4"),
    ("changelog.html", "monthly", "0.5"),
]


def url_entry(loc, lastmod=None, changefreq=None, priority=None):
    lines = [f"    <loc>{SITE}/{loc}</loc>"]
    if lastmod:
        lines.append(f"    <lastmod>{lastmod}</lastmod>")
    if changefreq:
        lines.append(f"    <changefreq>{changefreq}</changefreq>")
    if priority:
        lines.append(f"    <priority>{priority}</priority>")
    return "  <url>\n" + "\n".join(lines) + "\n  </url>"


urls = [url_entry(loc, None, cf, pr) for loc, cf, pr in STATIC_TOP]
urls += [url_entry(f"articles/{a['slug']}.html", a["modified"], None, "0.8") for a in articles]
urls += [url_entry(loc, None, cf, pr) for loc, cf, pr in STATIC_BOTTOM]
write(
    "sitemap.xml",
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + "\n".join(urls)
    + "\n</urlset>\n",
)

# llms.txt
lines = [
    f"- [{a['llmsTitle']}]({SITE}/articles/{a['slug']}.html): {a['llmsSummary']} "
    f"Markdown: {SITE}/articles/{a['slug']}.md"
    for a in articles
]
template = (ROOT / "scripts/llms.template.txt").read_text()
write("llms.txt", template.replace("{{ARTICLES}}", "\n".join(lines)))

# llms-full.txt
full_head = (
    "# Reframed: full article text\n\n"
    "> Every article on behaviorized.net in Markdown, newest first. Written by Hexp Studios, "
    "publisher of Reframed, an iOS wellbeing tool inspired by cognitive behavioural techniques "
    "(not a substitute for professional mental healthcare, diagnosis or treatment; each article "
    f"ends with a note on limits). Index: {SITE}/llms.txt\n"
)
write("llms-full.txt", full_head + "".join("\n---\n\n" + md[a["slug"]] for a in articles))

if CHECK:
    if changed:
        print("Out of date:", *changed, sep="\n  ")
        sys.exit(1)
    print("Up to date.")
else:
    print("Updated:", *changed, sep="\n  ") if changed else print("Nothing to update.")
