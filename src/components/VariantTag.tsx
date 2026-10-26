/**
 * The variant (flavour / size / option) as a box you can't miss. Staff pack
 * from this, not from the photo — product images are sometimes of a
 * different variant. Multi-option variants ("Dark / 500g") are split so
 * each choice reads on its own.
 */
export function VariantTag({ variant, size = 'md' }: { variant: string | null | undefined; size?: 'md' | 'lg' }) {
  const value = variant?.trim();
  if (!value || value === 'Default Title') return null;
  const options = value.split(/\s+\/\s+/).filter(Boolean);
  const big = size === 'lg';
  return (
    <div
      className={`mt-1.5 inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-amber-100 ring-2 ring-amber-400 ${
        big ? 'px-4 py-2' : 'px-2.5 py-1'
      }`}
    >
      <span className={`font-semibold uppercase tracking-wide text-amber-800 ${big ? 'text-xs' : 'text-[10px]'}`}>
        Variant
      </span>
      {options.map((o, i) => (
        <span key={i} className={`font-bold text-cocoa-900 [overflow-wrap:anywhere] ${big ? 'text-2xl' : 'text-base'}`}>
          {i > 0 && <span className="mr-2 font-normal text-amber-700">·</span>}
          {o}
        </span>
      ))}
    </div>
  );
}
