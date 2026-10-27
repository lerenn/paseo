/**
 * Whether `RuntimeBadge` draws nothing: the host indicator already shows the runtime's `hostIcon`
 * and the runtime has no label of its own to add. Callers that place a separator next to the
 * badge ask this first, so the separator is not left dangling beside an empty slot.
 */
export function isRuntimeBadgeHidden(
  details: { hostIcon?: string | null; label?: string | null } | null,
  hostIconShown: boolean,
): boolean {
  return hostIconShown && Boolean(details?.hostIcon) && !details?.label?.trim();
}
