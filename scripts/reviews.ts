// Human decisions are separate from collector-owned data and never auto-merged.
export function validateOpenIDReviews(reviewed: any): void {
  if (!reviewed || typeof reviewed !== 'object' || Array.isArray(reviewed)) throw new Error('Expected review catalog object');
  for (const [key, value] of Object.entries(reviewed) as [string, any][]) {
    if (!key.startsWith('openid:')) continue;
    const name = key.slice('openid:'.length);
    if (!/^[A-Za-z0-9_.-]+$/.test(name) || !value || !['confirmed','excluded'].includes(value.status) ||
        value.url !== `https://openid.net/specs/${name}.html` || typeof value.rev !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value.sha256 ?? '') ||
        typeof value.title !== 'string' || !value.title.trim() || typeof value.reason !== 'string' || !value.reason.trim() ||
        typeof value.reviewedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.reviewedAt) || !Number.isFinite(Date.parse(value.reviewedAt))) {
      throw new Error(`Invalid OpenID review: ${key}; set status, official URL, rev, SHA-256, title, reason and reviewedAt`);
    }
  }
}

export function openIDReviewState(decision: any, document: any): 'listed' | 'confirmed' | 'excluded' | 'needs_review' {
  if (!decision) return 'listed';
  // Missing or changed body data cannot confirm a review or keep an exclusion.
  return decision.url === document.url && decision.rev === document.revision &&
    /^[a-f0-9]{64}$/.test(document.sha256 ?? '') && decision.sha256 === document.sha256
    ? decision.status : 'needs_review';
}
