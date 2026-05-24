# Kratos

Strength. Discipline. Execution.

Kratos is a tiny static webapp that translates trainer-shorthand from your
weekly strength program into plain English and explains each exercise.

- **Input**: paste a tab from your Google Sheet, or upload one CSV per week.
- **Output**: a mobile-friendly card per exercise — name, target muscles,
  sets/reps/weight, plain-English how-to, your notes with jargon explained
  on hover, and a quick demo link.
- **Stack**: hand-written HTML / CSS / ES module JS. No build, no deps.
- **Privacy**: data lives in your browser (`localStorage`) only.

## Use it

Live: <https://oveku.github.io/kratos/>

1. In Google Sheets: **File → Download → Comma-separated values (.csv)**.
2. Upload that file (or paste its contents) into Kratos. Filename → week label.
3. Repeat per week tab.

## Glossary

Exercise names and modifiers (RPE, tempo, AMRAP, ...) live in
[`data/glossary.json`](data/glossary.json). Add or refine entries by editing
that file — no code changes needed.

## Develop

It's static. Open `index.html` directly, or run any static server:

```bash
python -m http.server 8000
# http://localhost:8000/
```

## Deploy

GitHub Pages via the workflow in [`.github/workflows/pages.yml`](.github/workflows/pages.yml).
Push to `main` → deployed.
