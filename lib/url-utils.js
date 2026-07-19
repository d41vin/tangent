// Keep page-defining query parameters (for example, YouTube's `v`) intact.
// This is deliberately a denylist rather than stripping every query string.
export const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid', 'twclid', 'igshid',
  'mc_cid', 'mc_eid', 'ref', 'ref_src', 'ref_url', '_ga', '_gl', 'si', 'spm',
];

export function cleanUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    TRACKING_PARAMS.forEach((param) => url.searchParams.delete(param));
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function shouldRecord(session, cleanedUrl) {
  const links = session.links ?? [];
  const lastEntry = links[links.length - 1];
  if (lastEntry?.url === cleanedUrl) return false;
  return !links.some((link) => link.url === cleanedUrl);
}
