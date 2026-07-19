function escapeMarkdownLinkText(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('[', '\\[').replaceAll(']', '\\]');
}

function escapeMarkdownLinkDestination(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll(')', '\\)');
}

// The menu's Copy and Download actions intentionally share this one formatter.
export function formatNoteForExport(note, includeLinks = false) {
  const content = String(note?.content ?? '');
  if (!includeLinks) return content;

  const links = Array.isArray(note?.links) ? note.links : [];
  const formattedLinks = links.map((link, index) => {
    const title = link?.title || link?.url || 'Untitled link';
    const url = link?.url || '';
    return `${index + 1}. [${escapeMarkdownLinkText(title)}](${escapeMarkdownLinkDestination(url)})`;
  });

  return `${content}\n\n—\nLinks:\n${formattedLinks.join('\n')}`;
}

export function markdownFilename(title) {
  const base = String(title ?? 'tangent-note')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
  return `${base || 'tangent-note'}.md`;
}
