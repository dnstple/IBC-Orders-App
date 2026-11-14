import { ImageResponse } from 'next/og';

export const runtime = 'edge';

/**
 * Brand-font lines for the visit emails, as PNG images (2x for sharp screens).
 * Gmail and Outlook ignore web fonts, so the name and the closing line are
 * drawn here in the real fonts:
 *   /r/img/wordmark?on=dark   "ITALIAN BEAR CHOCOLATE" in League Gothic, cream on brown (branded header bar)
 *   /r/img/wordmark?on=light  the same in brown on cream (letter style)
 *   /r/img/tagline?t=...      the closing line in Cookie, brown on cream
 * The light versions are see-through with a thin cream outline round the
 * letters: invisible on the cream email, but it keeps the brown lettering
 * readable when a dark-mode inbox darkens the background (no visible box).
 * Public (images in emails load without sign-in).
 * Fonts: Google Fonts, SIL Open Font License (OFL-fonts.txt).
 */
const leagueGothic = fetch(new URL('./LeagueGothic-Regular.ttf', import.meta.url)).then((r) => r.arrayBuffer());
const cookie = fetch(new URL('./Cookie-Regular.ttf', import.meta.url)).then((r) => r.arrayBuffer());

const W = 720; // drawn at 2x; the email shows it at 360px wide
const DARK = '#4b2a1e';
const MILK = '#f8f2ec';
// A soft cream halo, drawn as 8 small shadows round each letter.
const halo = (r: number) => [[r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, -r], [r, -r], [-r, r]].map(([x, y]) => `${x}px ${y}px 0 ${MILK}`).join(', ');

export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  const url = new URL(req.url);
  const headers = { 'Cache-Control': 'public, max-age=31536000, immutable' };

  if (kind === 'wordmark') {
    const light = url.searchParams.get('on') === 'light';
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: light ? 'flex-start' : 'center', background: light ? 'transparent' : DARK, paddingLeft: light ? 6 : 0 }}>
          <span style={{ fontFamily: 'League Gothic', fontSize: 84, letterSpacing: 5, color: light ? DARK : MILK, lineHeight: 1, textShadow: light ? halo(3) : 'none' }}>
            ITALIAN BEAR CHOCOLATE
          </span>
        </div>
      ),
      { width: W, height: 112, fonts: [{ name: 'League Gothic', data: await leagueGothic, style: 'normal', weight: 400 }], headers },
    );
  }

  if (kind === 'tagline') {
    const text = (url.searchParams.get('t') ?? 'All you need is chocolate').replace(/[^\p{L}\p{N} .,'’!&-]/gu, '').slice(0, 40).trim()
      || 'All you need is chocolate';
    // Cookie averages ~0.29em per character: shrink long lines so they always fit.
    const size = Math.min(96, Math.floor((W - 40) / (text.length * 0.3)));
    return new ImageResponse(
      (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: url.searchParams.get('align') === 'left' ? 'flex-start' : 'center', paddingLeft: 6 }}>
          <span style={{ fontFamily: 'Cookie', fontSize: size, color: DARK, lineHeight: 1, textShadow: halo(3) }}>{text}</span>
        </div>
      ),
      { width: W, height: 132, fonts: [{ name: 'Cookie', data: await cookie, style: 'normal', weight: 400 }], headers },
    );
  }

  return new Response('Not found', { status: 404 });
}
