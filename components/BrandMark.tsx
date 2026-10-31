/** Shared Tsumu symbol for home, editor, loading and sign-in screens. */
export default function BrandMark({ size = 40 }: { size?: number }) {
  return (
    // The SVG is already optimized; native img also works in standalone editor tests.
    // eslint-disable-next-line @next/next/no-img-element
    <img className="brand-mark" src="/tsumu-mark.svg" alt="Tsumu" width={size} height={size} />
  );
}
