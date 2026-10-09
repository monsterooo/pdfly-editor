# PDFLY Editor

In-browser PDF editor. Click a line, type, and the original glyphs are
removed from the page content (MuPDF redaction, text only) before the new text
is written on the same baseline in the closest standard font, size and colour
(or the font, size and colour picked in the format bar).

On top of that: text boxes, signatures (draw, type or upload), images,
whiteout, highlight / underline / strike-out, rectangles, ellipses, lines,
arrows and freehand drawing, all selectable, movable and restyleable; page
rotate / insert / delete; find in document; page thumbnails, zoom and
keyboard shortcuts. Added items are PDF annotations while editing and are
flattened into the page content on download. The PDF never leaves the browser.

Built on [MuPDF.js](https://github.com/ArtifexSoftware/mupdf.js).

## License

AGPL-3.0-only, see [LICENSE](./LICENSE). MuPDF is © Artifex Software, Inc.,
used under the AGPL. Every deployed copy links to this source.

## Develop

```sh
pnpm install
pnpm dev          # http://localhost:3002
pnpm test         # engine and UI logic tests (Node, real MuPDF)
pnpm check-types
```

## Build

```sh
VITE_SOURCE_URL=<public repo URL> \
VITE_HOST_ORIGINS=<comma-separated origins allowed to embed the editor> \
pnpm build
```

The build refuses to run without `VITE_SOURCE_URL`.

## Embedding

The editor talks to an embedding page only through `postMessage`, to the
origins in `VITE_HOST_ORIGINS` (see `src/lib/host-bridge.ts`):

- `{ type: "pdfly-editor:height", height, workspace }`: content height, or
  `workspace: true` once a PDF is open (the host should give it the viewport).
- `{ type: "pdfly-editor:event", name }`: `edit_opened`, `edit_saved`, `edit_failed`.

## Layout

- `src/worker/engine.ts`: all MuPDF work (open, render, find lines, replace,
  page operations, search, undo/redo via the MuPDF journal, save with
  flattening and font subsetting).
- `src/worker/items.ts`: added items as annotations tagged `/PdflyItem`
  (create, move, restyle, flatten only ours on save).
- `src/worker/mupdf.worker.ts`: message routing in a Web Worker.
- `src/lib/`: pure helpers (geometry, font matching, content stream
  operators, protocol, client, host bridge).
- `src/components/`: React UI.
