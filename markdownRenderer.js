const FENCE_RE = /^```([A-Za-z0-9_-]+)?\s*$/;

export function renderMarkdownInto(element, markdown) {
  element.classList.add("markdown-body");
  element.innerHTML = renderMarkdown(markdown);
}

export function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    const fence = trimmed.match(FENCE_RE);
    if (fence) {
      flushParagraph(blocks, paragraph);
      paragraph = [];
      const codeLines = [];
      index += 1;
      while (index < lines.length && !FENCE_RE.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      const language = fence[1] ? ` data-language="${escapeAttr(fence[1])}"` : "";
      blocks.push(`<pre${language}><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    if (!trimmed) {
      flushParagraph(blocks, paragraph);
      paragraph = [];
      continue;
    }

    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph(blocks, paragraph);
      paragraph = [];
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph(blocks, paragraph);
      paragraph = [];
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push(`<blockquote>${quoteLines.map(renderInline).join("<br>")}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      flushParagraph(blocks, paragraph);
      paragraph = [];
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const items = [];
      const itemRe = ordered ? /^\d+[.)]\s+/ : /^[-*+]\s+/;
      while (index < lines.length && itemRe.test(lines[index].trim())) {
        items.push(`<li>${renderInline(lines[index].trim().replace(itemRe, ""))}</li>`);
        index += 1;
      }
      index -= 1;
      blocks.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph(blocks, paragraph);
  return blocks.join("");
}

function flushParagraph(blocks, paragraph) {
  if (!paragraph.length) return;
  blocks.push(`<p>${paragraph.map((line) => renderInline(line.trim())).join("<br>")}</p>`);
}

function renderInline(value) {
  const codeSpans = [];
  let text = String(value || "").replace(/`([^`]+)`/g, (_, code) => {
    const token = `\u0000CODE${codeSpans.length}\u0000`;
    codeSpans.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (_, label, href) => {
    return `<a href="${escapeAttr(decodeBasicEntities(href))}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");

  return text.replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeSpans[Number(index)] || "");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function decodeBasicEntities(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
