---
id: topic-search
title: Topic Search
status: verified
keywords: topic search, search, find, word, phrase, page number, book, pdf, content_text, ilike, full text, search_vector, variants, spelling, accent, dosha, dosa, OCR, viewer, highlight, match, in-app pdf viewer
---

## What Topic Search does

Topic Search looks for a word or phrase inside the extracted text of every Notes PDF and Test Paper PDF. It reports every match with its book and page number. Selecting a match opens the in-app PDF viewer at that page and highlights the matching text.

It does not search notices, chat messages, community posts, student profiles, or AI conversations.

## Search pipeline

The search runs in the browser and uses three database strategies, then a client-side fallback:

1. Literal substring search: `pdfs.content_text ilike '%query%'`, with `%`, `_`, and backslashes escaped. This finds partial words and terms inside larger words.
2. Spelling/accent variants: `searchVariants()` strips accents, normalizes punctuation, and generates up to four variants such as s/sh substitutions and a wildcard form. These are sent as an OR filter of `ilike` conditions.
3. Multi-word full-text search: for queries with more than one word, it uses the generated `search_vector` column with PostgreSQL `websearch` full-text search in the `english` configuration.
4. Last resort: if every database query failed, it downloads up to 200 rows with extracted text and filters them in the browser.

Results from the strategies are merged by PDF id, so a book appears once. The app then scans the stored text for every occurrence.

## How matches and page numbers are found

Extracted text contains page markers like `[[PAGE 12]]`. The client splits the text on those markers, scans each page with a fuzzy regular expression, and records the page number plus a short snippet. The snippet is cleaned of common OCR clutter while preserving matched words.

The matcher treats accented and unaccented forms as equivalent, treats s/sh/ṣ/ś as similar, and first tries the exact phrase. If the exact phrase is absent, it matches any of the typed words. This is why searches such as "dosa" can find "dosha" or "doṣa".

Each book is capped at 1,500 hits. The results view shows 30 hits first and then loads 60 more at a time. Books are sorted by hit count.

## In-app PDF viewer

Tapping a hit opens a full-screen viewer built on PDF.js. It:

- Opens the original PDF URL at the selected page.
- Renders one page at a time on a canvas.
- Draws highlight boxes over matching text when a text layer is available.
- Provides previous/next page, direct page jump, zoom from 0.5x to 3x, previous/next matching page, an external "open original" link, keyboard arrows, and Escape to close.
- Falls back to a link that opens the PDF in the browser if the in-app viewer cannot load it.

## Limits and dependencies

- Search quality depends entirely on `pdfs.content_text`. A scanned PDF with no text layer and no successful OCR is not searchable.
- OCR is English-only by default, so Devanagari or Sanskrit scans may produce poor text unless the OCR language configuration is changed.
- PDF text extraction is capped at 2,000 pages and about 9 million characters per book.
- The actual search runs over all matching rows returned by the database; there is no server-side pagination for the initial search.
- The viewer and OCR libraries are loaded from public CDNs, so they need network access.
- PDF.js can fail on some very large or unusual files; the fallback is the browser's own PDF viewer.

Status: verified for text-based PDFs. Partial for scanned books, non-English OCR, and very large files.

## Common errors

- "Type at least 2 characters." The query is too short.
- "No matches found for that word. Try a different spelling or a shorter search." Nothing matched.
- "Search failed" means all database strategies failed, usually a network or permission problem.
- "This book could not be opened here..." means the in-app viewer failed; the external link should still work.
