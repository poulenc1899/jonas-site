// Static site builder for jonas.bergmann-rowe.com.
//
// Reads Markdown from content/ (edited by hand, on GitHub, or via Pages CMS),
// looks up co-authors for every publication with a DOI on OpenAlex, and writes
// plain HTML to dist/. Network lookups are cached in data/openalex-cache.json so
// the build still works offline or if an API is down.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const CONTENT = path.join(ROOT, 'content');
const PUBLIC = path.join(ROOT, 'public');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const CACHE_FILE = path.join(ROOT, 'data', 'openalex-cache.json');
const SITE_URL = 'https://jonas.bergmann-rowe.com';

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const md = (s) => marked.parse(s || '');
const mdInline = (s) => marked.parseInline(s || '');

const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const normName = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

const bareOrcid = (s) => (s ? String(s).replace(/^https?:\/\/orcid\.org\//, '').trim() : null);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Dates may be YYYY, YYYY-MM or YYYY-MM-DD (YAML may also hand us a Date).
function parseDate(d) {
  if (!d) return { sort: '0000', year: '', label: '' };
  if (d instanceof Date) d = d.toISOString().slice(0, 10);
  const [y, m, day] = String(d).split('-');
  const label = m ? `${day ? Number(day) + ' ' : ''}${MONTHS[Number(m) - 1]} ${y}` : y;
  return { sort: String(d), year: y, label };
}

function readCollection(dir) {
  const full = path.join(CONTENT, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const { data, content } = matter(fs.readFileSync(path.join(full, f), 'utf8'));
      return { ...data, slug: slugify(data.slug || f.replace(/\.md$/, '')), body: content.trim() };
    })
    .filter((x) => !x.draft);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    entry.isDirectory() ? copyDir(a, b) : fs.copyFileSync(a, b);
  }
}

function write(rel, html) {
  const out = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
}

// ---------- content ----------

const profileFile = matter(fs.readFileSync(path.join(CONTENT, 'profile.md'), 'utf8'));
const profile = { ...profileFile.data, body: profileFile.content.trim() };
const MY_ORCID = bareOrcid(profile.orcid);
const MY_NAMES = [profile.name, ...(profile.also_published_as || [])].map(normName);

const publications = readCollection('publications')
  .map((p) => ({ ...p, date: parseDate(p.date), doi: p.doi ? String(p.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//, '') : null }))
  .sort((a, b) => b.date.sort.localeCompare(a.date.sort));

const talks = readCollection('talks')
  .map((t) => ({ ...t, date: parseDate(t.date) }))
  .sort((a, b) => b.date.sort.localeCompare(a.date.sort));

const posts = readCollection('posts')
  .map((b) => ({ ...b, date: parseDate(b.date) }))
  .sort((a, b) => b.date.sort.localeCompare(a.date.sort));

// ---------- OpenAlex + citation lookups (cached) ----------

const cache = fs.existsSync(CACHE_FILE) ? JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) : {};

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'jonas.bergmann-rowe.com site build' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { Accept: 'text/x-bibliography; style=apa; locale=en-GB' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return (await res.text()).trim();
}

async function lookup(doi) {
  const entry = cache[doi] || {};
  try {
    const w = await fetchJson(`https://api.openalex.org/works/doi:${encodeURIComponent(doi)}`);
    entry.authors = w.authorships.map((a) => ({
      name: a.author.display_name,
      orcid: bareOrcid(a.author.orcid),
      institution: a.institutions?.[0]?.display_name || null,
    }));
    entry.title = w.title;
  } catch (e) {
    console.warn(`  OpenAlex lookup failed for ${doi} (${e.message}); using cache`);
  }
  try {
    entry.citation = await fetchText(`https://doi.org/${doi}`);
  } catch (e) {
    console.warn(`  citation lookup failed for ${doi} (${e.message}); using cache`);
  }
  cache[doi] = entry;
  return entry;
}

const isMe = (a) => (a.orcid && a.orcid === MY_ORCID) || MY_NAMES.includes(normName(a.name));

for (const p of publications) {
  // Authors listed in the Markdown win; otherwise use OpenAlex.
  const looked = p.doi ? await lookup(p.doi) : {};
  const fromMd = (p.authors || []).map((a) => (typeof a === 'string' ? { name: a } : { ...a, orcid: bareOrcid(a.orcid) }));
  p.authorList = (fromMd.length ? fromMd : looked.authors || [{ name: profile.name }]).map((a) => {
    // Fill in ORCIDs from OpenAlex for authors typed by name only.
    if (!a.orcid && looked.authors) {
      const m = looked.authors.find((x) => normName(x.name) === normName(a.name));
      if (m) a = { ...a, orcid: m.orcid, institution: a.institution || m.institution };
    }
    return isMe(a) ? { ...a, me: true, orcid: MY_ORCID } : a;
  });
  // Crossref sometimes returns already-escaped entities ("Mens &amp; Maatschappij").
  p.citation = (p.citation || looked.citation || '').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>') || null;
}

fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2) + '\n');

// ---------- co-author network ----------
// Bipartite graph: people <-> publications. Jonas links to every paper, so
// people who share several papers with Jonas sit between those papers.

function buildNetwork() {
  const people = new Map();
  const nodes = [];
  const links = [];
  const keyFor = (a) => (a.me ? 'me' : a.orcid ? `orcid:${a.orcid}` : `name:${normName(a.name)}`);

  for (const p of publications) {
    if (p.network === false || p.authorList.length < 2) continue;
    const pid = `pub:${p.slug}`;
    nodes.push({ id: pid, kind: 'pub', label: p.short_title || p.title, title: p.title, year: p.date.year, href: `/publications/${p.slug}/` });
    for (const a of p.authorList) {
      const key = keyFor(a);
      if (!people.has(key)) {
        const node = {
          id: key,
          kind: a.me ? 'me' : 'person',
          label: a.me ? profile.name : a.name,
          orcid: a.orcid || null,
          institution: a.me ? (profile.affiliations || []).join(', ') || null : a.institution || null,
          papers: 0,
        };
        people.set(key, node);
        nodes.push(node);
      }
      people.get(key).papers += 1;
      links.push({ source: key, target: pid });
    }
  }
  return { nodes, links };
}

const network = buildNetwork();
const coauthorCount = network.nodes.filter((n) => n.kind === 'person').length;

// ---------- templates ----------

const icons = {
  orcid: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="#A6CE39"/><path fill="#fff" d="M8.3 7.4a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Zm-.7 1.4h1.4v8.7H7.6V8.8Zm3.3 0h3.7c3.5 0 5 2.5 5 4.4 0 2.1-1.6 4.4-5 4.4h-3.7V8.8Zm1.4 7.5h2.2c3.1 0 3.8-2.4 3.8-3.1 0-1.2-.8-3.2-3.8-3.2h-2.2v6.3Z"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 10.5V16M8 7.5v.01M12 16v-5.5M12 13a2.5 2.5 0 0 1 5 0v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};

function layout({ title, description, body, canonical, depth = 0 }) {
  const base = depth ? '../'.repeat(depth) : './';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${SITE_URL}${canonical}" />
  ${profile.hide_from_search ? '<meta name="robots" content="noindex, nofollow" />' : ''}
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${SITE_URL}${canonical}" />
  ${profile.photo ? `<meta property="og:image" content="${SITE_URL}/${esc(String(profile.photo).replace(/^\//, ''))}" />` : ''}
  <meta name="theme-color" content="#f7f6f2" media="(prefers-color-scheme: light)" />
  <meta name="theme-color" content="#141513" media="(prefers-color-scheme: dark)" />
  <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${base}style.css" />
</head>
<body>
${body}
<footer class="site-footer">
  <div class="wrap">
    <span>© ${new Date().getFullYear()} ${esc(profile.name)}</span>
    <a href="https://bergmann-rowe.com/">bergmann-rowe.com</a>
  </div>
</footer>
</body>
</html>
`;
}

function authorsHtml(list, { links = false } = {}) {
  return list
    .map((a) => {
      let name = esc(a.name);
      if (a.me) name = `<strong>${esc(profile.name)}</strong>`;
      if (links && a.orcid && !a.me) name = `<a href="https://orcid.org/${esc(a.orcid)}" title="ORCID profile">${name}</a>`;
      return `<span class="author">${name}</span>`;
    })
    .join(', ');
}

function compactAuthors(list) {
  if (list.length <= 6) return authorsHtml(list);
  const meIdx = list.findIndex((a) => a.me);
  const head = list.slice(0, 3);
  const extra = meIdx >= 3 ? `, …, ${authorsHtml([list[meIdx]])}` : '';
  return `${authorsHtml(head)}${extra}, … (${list.length} authors)`;
}

const typeLabel = (t) => t || 'Publication';

function pubCard(p) {
  const href = `publications/${p.slug}/`;
  return `<li class="pub">
  <div class="pub-meta"><span class="badge">${esc(typeLabel(p.type))}</span><span>${esc(p.date.label)}</span>${p.venue ? `<span class="venue">${esc(p.venue)}</span>` : ''}</div>
  <h3><a href="${href}">${esc(p.title)}</a></h3>
  <p class="pub-authors">${compactAuthors(p.authorList)}</p>
  ${p.summary ? `<p class="pub-summary">${mdInline(p.summary)}</p>` : ''}
  <p class="pub-links">
    <a href="${href}">Read more</a>
    ${p.doi ? `<a href="https://doi.org/${esc(p.doi)}">DOI</a>` : ''}
    ${p.url && !p.doi ? `<a href="${esc(p.url)}">View</a>` : ''}
    ${(p.files || []).length ? `<span class="muted">${p.files.length} download${p.files.length > 1 ? 's' : ''}</span>` : ''}
  </p>
</li>`;
}

function talkItem(t) {
  const title = t.url ? `<a href="${esc(t.url)}">${esc(t.title)}</a>` : esc(t.title);
  return `<li class="talk">
  <div class="talk-date">${esc(t.date.label)}</div>
  <div>
    <h3>${title}</h3>
    <p class="muted">${[t.type, t.event, t.location].filter(Boolean).map(esc).join(' · ')}</p>
    ${t.body ? `<div class="talk-body">${md(t.body)}</div>` : ''}
  </div>
</li>`;
}

function postItem(b, prefix = 'blog/') {
  return `<li class="talk">
  <div class="talk-date">${esc(b.date.label)}</div>
  <div>
    <h3><a href="${prefix}${b.slug}/">${esc(b.title)}</a></h3>
    ${b.summary ? `<p>${mdInline(b.summary)}</p>` : ''}
  </div>
</li>`;
}

function cvList(items, kind) {
  return (items || [])
    .map((x) => {
      const upcoming = /^(incoming|upcoming)$/i.test(String(x.start || ''));
      const when = upcoming || (x.end && x.end === x.start) ? x.start : [x.start, x.end || (kind === 'positions' ? 'present' : '')].filter(Boolean).join(' – ');
      return `<li><div class="cv-when">${esc(when)}</div><div><strong>${esc(x.role || x.degree)}</strong><br /><span class="muted">${esc([x.org, x.dept].filter(Boolean).join(', '))}</span>${x.note ? `<p>${mdInline(x.note)}</p>` : ''}</div></li>`;
    })
    .join('\n');
}

function profileLinks() {
  const out = [];
  if (profile.orcid) out.push(`<a class="chip" href="https://orcid.org/${esc(MY_ORCID)}">${icons.orcid}<span>ORCID</span></a>`);
  if (profile.linkedin) out.push(`<a class="chip" href="${esc(profile.linkedin)}">${icons.linkedin}<span>LinkedIn</span></a>`);
  if (profile.email) out.push(`<a class="chip" href="mailto:${esc(profile.email)}">${icons.mail}<span>Email</span></a>`);
  for (const l of profile.links || []) out.push(`<a class="chip" href="${esc(l.url)}">${icons.link}<span>${esc(l.label)}</span></a>`);
  return out.join('\n');
}

// ---------- pages ----------

const description = profile.tagline || `${profile.name} — publications and research.`;

const indexBody = `
<header class="hero">
  <div class="wrap hero-inner">
    ${profile.photo ? `<img class="portrait" src="${esc(profile.photo)}" alt="Portrait of ${esc(profile.name)}" width="160" height="160" />` : ''}
    <div>
      <h1>${esc(profile.name)}</h1>
      ${profile.pronouns ? `<p class="pronouns">${esc(profile.pronouns)}</p>` : ''}
      <p class="role">${esc(profile.title || '')}</p>
      ${(profile.affiliations || []).length ? `<p class="muted">${profile.affiliations.map(esc).join(' · ')}</p>` : ''}
      <div class="chips">${profileLinks()}</div>
    </div>
  </div>
</header>

<nav class="toc wrap" aria-label="Sections">
  <a href="#about">About</a><a href="#publications">Publications</a><a href="#network">Network</a><a href="#writing">Writing</a>${talks.length ? '<a href="#talks">Talks</a>' : ''}<a href="#cv">CV</a>
</nav>

<main class="wrap">
  <section id="about">
    <h2>About</h2>
    <div class="prose">${md(profile.body)}</div>
    ${(profile.interests || []).length ? `<ul class="tags">${profile.interests.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
  </section>

  <section id="publications">
    <h2>Publications</h2>
    ${profile.also_published_as?.length ? `<p class="muted small">Publishes as ${profile.also_published_as.map(esc).join(', ')}.</p>` : ''}
    <ol class="pubs">${publications.map(pubCard).join('\n')}</ol>
  </section>

  <section id="network">
    <h2>Collaboration network</h2>
    <p class="muted small">${coauthorCount} co-authors across ${network.nodes.filter((n) => n.kind === 'pub').length} publications. Hover or tap a person to see their affiliation; click to open their ORCID profile. Larger dots are people ${esc(profile.name.split(' ')[0])} has published with more than once. Co-authors are looked up on <a href="https://openalex.org">OpenAlex</a> from each publication's DOI.</p>
    <div class="network" id="network-chart" role="img" aria-label="Network diagram of co-authors connected through shared publications"></div>
    <details class="network-list">
      <summary>List of co-authors</summary>
      <ul>${network.nodes
        .filter((n) => n.kind === 'person')
        .sort((a, b) => b.papers - a.papers || a.label.localeCompare(b.label))
        .map((n) => `<li>${n.orcid ? `<a href="https://orcid.org/${esc(n.orcid)}">${esc(n.label)}</a>` : esc(n.label)}${n.institution ? ` <span class="muted">— ${esc(n.institution)}</span>` : ''}${n.papers > 1 ? ` <span class="badge">${n.papers} papers</span>` : ''}</li>`)
        .join('')}</ul>
    </details>
  </section>

  <section id="writing"><h2>Writing</h2>${posts.length ? `<ol class="talks">${posts.slice(0, 3).map((b) => postItem(b)).join('\n')}</ol>${posts.length > 3 ? `<p><a href="blog/">All ${posts.length} posts →</a></p>` : ''}` : '<p class="muted">New posts coming soon.</p>'}</section>

  ${talks.length ? `<section id="talks"><h2>Talks &amp; outreach</h2><ol class="talks">${talks.map(talkItem).join('\n')}</ol></section>` : ''}

  <section id="cv">
    <h2>CV</h2>
    <div class="cv-grid">
      <div><h3>Positions</h3><ul class="cv">${cvList(profile.positions, 'positions')}</ul></div>
      <div>
        <h3>Education</h3><ul class="cv">${cvList(profile.education, 'education')}</ul>
        ${(profile.memberships || []).length ? `<h3 class="cv-sub">Memberships</h3><ul class="cv">${cvList(profile.memberships, 'positions')}</ul>` : ''}
      </div>
    </div>
  </section>
</main>

<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>
<script src="network.js"></script>
`;

function pubPage(p) {
  const files = (p.files || [])
    .map((f) => {
      const href = /^https?:/.test(f.file) ? f.file : `/${String(f.file).replace(/^\/?(public\/)?/, '')}`;
      return `<li><a class="download" href="${esc(href)}" ${/^https?:/.test(f.file) ? '' : 'download'}>${icons.file}<span>${esc(f.label || path.basename(f.file))}</span></a></li>`;
    })
    .join('');
  const links = [
    ...(p.doi ? [{ label: `doi.org/${p.doi}`, url: `https://doi.org/${p.doi}` }] : []),
    ...(p.url && p.url !== `https://doi.org/${p.doi}` ? [{ label: p.url_label || 'View online', url: p.url }] : []),
    ...(p.links || []),
  ]
    .map((l) => `<li><a class="download" href="${esc(l.url)}">${icons.link}<span>${esc(l.label)}</span></a></li>`)
    .join('');

  const body = `
<header class="page-head wrap">
  <a class="back" href="../../#publications">← ${esc(profile.name)}</a>
  <div class="pub-meta"><span class="badge">${esc(typeLabel(p.type))}</span><span>${esc(p.date.label)}</span>${p.venue ? `<span class="venue">${esc(p.venue)}</span>` : ''}${p.open_access ? '<span class="badge oa">Open access</span>' : ''}</div>
  <h1>${esc(p.title)}</h1>
  <p class="pub-authors">${authorsHtml(p.authorList, { links: true })}</p>
</header>
<main class="wrap pub-page">
  <article class="prose">
    ${p.summary ? `<p class="lede">${mdInline(p.summary)}</p>` : ''}
    ${md(p.body)}
  </article>
  <aside class="pub-aside">
    ${links ? `<h2>Links</h2><ul class="downloads">${links}</ul>` : ''}
    ${files ? `<h2>Downloads</h2><ul class="downloads">${files}</ul>` : ''}
    ${p.citation ? `<h2>Cite</h2><p class="citation" id="citation">${esc(p.citation)}</p><button class="copy" type="button" data-copy="citation">Copy citation</button>` : ''}
  </aside>
</main>
<script>
document.querySelectorAll('[data-copy]').forEach(function (b) {
  b.addEventListener('click', function () {
    navigator.clipboard.writeText(document.getElementById(b.dataset.copy).textContent).then(function () {
      b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy citation'; }, 1500);
    });
  });
});
</script>
`;
  return layout({
    title: `${p.title} — ${profile.name}`,
    description: p.summary ? p.summary.replace(/[*_`[\]]/g, '') : description,
    body,
    canonical: `/publications/${p.slug}/`,
    depth: 2,
  });
}

function postPage(b) {
  const body = `
<header class="page-head wrap">
  <a class="back" href="../../#writing">← ${esc(profile.name)}</a>
  <div class="pub-meta"><span>${esc(b.date.label)}</span></div>
  <h1>${esc(b.title)}</h1>
</header>
<main class="wrap post-page">
  <article class="prose">
    ${b.summary ? `<p class="lede">${mdInline(b.summary)}</p>` : ''}
    ${md(b.body)}
  </article>
  <p><a class="back" href="../">All posts</a></p>
</main>
`;
  return layout({
    title: `${b.title} — ${profile.name}`,
    description: b.summary ? b.summary.replace(/[*_`[\]]/g, '') : description,
    body,
    canonical: `/blog/${b.slug}/`,
    depth: 2,
  });
}

function blogIndex() {
  const body = `
<header class="page-head wrap">
  <a class="back" href="../">← ${esc(profile.name)}</a>
  <h1>Writing</h1>
</header>
<main class="wrap post-page"><ol class="talks">${posts.map((b) => postItem(b, '')).join('\n')}</ol></main>
`;
  return layout({ title: `Writing — ${profile.name}`, description, body, canonical: '/blog/', depth: 1 });
}

// ---------- write ----------

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
copyDir(PUBLIC, DIST);
copyDir(SRC, DIST);
write('index.html', layout({ title: `${profile.name} — ${profile.title || 'Research'}`, description, body: indexBody, canonical: '/' }));
for (const p of publications) write(`publications/${p.slug}/index.html`, pubPage(p));
if (posts.length) {
  write('blog/index.html', blogIndex());
  for (const b of posts) write(`blog/${b.slug}/index.html`, postPage(b));
}
write('network.json', JSON.stringify(network));
write(
  'robots.txt',
  profile.hide_from_search ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`
);
write(
  'sitemap.xml',
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${['/', ...publications.map((p) => `/publications/${p.slug}/`), ...(posts.length ? ['/blog/', ...posts.map((b) => `/blog/${b.slug}/`)] : [])]
    .map((u) => `  <url><loc>${SITE_URL}${u}</loc></url>`)
    .join('\n')}\n</urlset>\n`
);

console.log(`Built ${publications.length} publications, ${talks.length} talks, ${posts.length} posts, ${coauthorCount} co-authors -> dist/`);
