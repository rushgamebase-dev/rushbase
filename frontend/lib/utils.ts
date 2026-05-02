/**
 * Tiny `cn()` helper. Tailwind components ported from the standalone
 * TapTrade repo expect this; we re-implement minimally instead of
 * pulling clsx + tailwind-merge as a dep.
 */
export function cn(
  ...inputs: Array<string | number | boolean | null | undefined>
): string {
  return inputs.filter(Boolean).join(" ");
}
