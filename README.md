# jonas.bergmann-rowe.com

Jonas's academic page: profile, publications (each with its own page for context, links and downloads), talks, CV, and a co-author network.

## Editing (the easy way): Pages CMS

1. Go to **https://app.pagescms.org** and sign in with GitHub.
2. Open the `poulenc1899/jonas-site` repository (you need to be added as a collaborator first).
3. Use the sidebar: **Publications**, **Talks & outreach**, **Profile & CV**.
4. Click **Save**. That's it — the site rebuilds and is live in about a minute.

### Adding a publication

- **Add an entry** under *Publications*. Fill in the title, a short title, type, date and — most importantly — the **DOI** if there is one.
- With a DOI, the site looks up the full author list, everyone's ORCID iD and a formatted APA citation automatically, and adds the co-authors to the network diagram.
- No DOI (e.g. a poster or report)? Leave DOI empty, fill in *Web address*, and list the authors yourself under *Authors* (add ORCID iDs if you know them).
- **Context** is the long text on the publication's own page: the story behind it, findings, thanks, photos.
- **Downloads**: upload PDFs, slides, posters or supplementary data. They're served from `/files/…`.
- Tick **Draft** to hide something while you work on it.

### Blog posts

Under **Blog posts**, add an entry with a title, date, one-line summary and the post itself (images can be dropped in). A *Writing* section appears on the homepage (latest three posts) along with a page listing every post at `/blog/` as soon as the first non-draft post is saved.

### Changing the layout or design

Layout and design live in code (`build.mjs` for the page structure, `src/style.css` for colours, fonts and spacing). The easiest way to change them is to ask Claude at **https://claude.ai/code**: pick this repository and describe what you want. Ask it to show you a preview before it saves.

### Dates

Use `YYYY-MM-DD`, or `YYYY-MM` / `YYYY` if you don't know the exact day.

## Editing directly on GitHub

Everything is plain Markdown in [`content/`](content):

- `content/profile.md` — about text, photo, links, positions, education, memberships
- `content/publications/*.md` — one file per publication (front matter + context)
- `content/talks/*.md` — one file per talk/outreach item
- `public/files/` — downloadable files; `public/images/` — images

Copy an existing publication file, rename it (the file name becomes the URL, e.g. `screenathon-2.md` → `/publications/screenathon-2/`), edit, commit.

## How it works

`build.mjs` turns the Markdown into static HTML in `dist/`. For each DOI it queries [OpenAlex](https://openalex.org) (authors, affiliations, ORCID iDs) and doi.org (APA citation); results are cached in `data/openalex-cache.json` so a build still works if those services are down. The network diagram (`src/network.js`, D3) links Jonas → publications → co-authors; people who share several papers with Jonas are drawn larger.

```sh
npm install
npm run build        # → dist/
npm run dev          # build and serve on http://localhost:8814
```

Hosted on Vercel (project `jonas`); every commit to `main` deploys automatically.
