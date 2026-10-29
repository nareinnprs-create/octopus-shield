// Export needs paper layouts without sticky chrome or hover affordances; keep it independent of live app styles.
export const EXPORT_CSS = `
* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #1f2328;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial,
    sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  font-size: 14px;
  line-height: 1.6;
}

.shield-export-root {
  padding: 0;
  max-width: 100%;
}

.shield-export-root h1,
.shield-export-root h2,
.shield-export-root h3,
.shield-export-root h4,
.shield-export-root h5,
.shield-export-root h6 {
  font-weight: 600;
  line-height: 1.25;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

.shield-export-root h1 { font-size: 1.9em; }
.shield-export-root h2 { font-size: 1.5em; }
.shield-export-root h3 { font-size: 1.25em; }
.shield-export-root h4 { font-size: 1em; }

.shield-export-root p,
.shield-export-root blockquote,
.shield-export-root ul,
.shield-export-root ol,
.shield-export-root pre,
.shield-export-root table {
  margin-top: 0;
  margin-bottom: 1em;
}

.shield-export-root a {
  color: #0969da;
  text-decoration: underline;
}

.shield-export-root blockquote {
  padding: 0 1em;
  color: #57606a;
  border-left: 0.25em solid #d0d7de;
}

.shield-export-root [data-callout] {
  margin: 0 0 1em;
  padding: 0 1em;
  border-left: 0.25em solid var(--callout);
}

.shield-export-root [data-callout] > :first-child {
  display: flex;
  align-items: center;
  gap: 0.4em;
  margin-bottom: 0.25em;
  color: var(--callout);
  font-weight: 600;
}

.shield-export-root [data-callout] > :first-child svg { width: 1em; height: 1em; }

.shield-export-root [data-callout="note"] { --callout: #0969da; }
.shield-export-root [data-callout="tip"] { --callout: #1a7f37; }
.shield-export-root [data-callout="important"] { --callout: #8250df; }
.shield-export-root [data-callout="warning"] { --callout: #9a6700; }
.shield-export-root [data-callout="caution"] { --callout: #cf222e; }

.shield-export-root code,
.shield-export-root pre {
  font-family: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
}

.shield-export-root code {
  background: #f6f8fa;
  padding: 0.2em 0.4em;
  border-radius: 4px;
}

.shield-export-root pre {
  background: #f6f8fa;
  padding: 12px 16px;
  border-radius: 6px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.shield-export-root pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}

.shield-export-root table {
  border-collapse: collapse;
  width: 100%;
}

.shield-export-root th,
.shield-export-root td {
  border: 1px solid #d0d7de;
  padding: 6px 12px;
  text-align: left;
}

.shield-export-root th { background: #f6f8fa; }

.shield-export-root img,
.shield-export-root svg {
  max-width: 100%;
  height: auto;
}

.shield-export-root ul,
.shield-export-root ol { padding-left: 2em; }

.shield-export-root li { margin: 0.25em 0; }

.shield-export-root input[type="checkbox"] {
  margin-right: 0.4em;
}

.shield-export-root hr {
  border: 0;
  border-top: 1px solid #d0d7de;
  margin: 1.5em 0;
}

/* Why: the export subtree selection already excludes the big chrome (toolbar,
   search bar, etc.), but in-document affordances like the code-copy button
   and preview annotation controls can still leak. Hide the well-known
   offenders as a belt-and-suspenders defense on top of DOM scrubbing. */
.code-block-copy-btn,
.markdown-preview-search,
.markdown-annotation-controls,
.rich-markdown-toolbar,
[data-shield-export-hide] {
  display: none !important;
}

.code-block-wrapper { position: static !important; }

@media print {
  pre, code, table, img, svg { page-break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
}
`
