import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { loadSettings } from '@/lib/visit-emails/engine';
import { destinationUrl, findLink } from '@/lib/visit-emails/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public links inside the thank-you emails (no sign-in).
 *   GET  /r/<token>/<link key>   -> counts the click, redirects to the link
 *   GET  /r/<token>/unsubscribe  -> "Stop emails?" page with a button
 *   POST /r/<token>/unsubscribe  -> adds the address to the do-not-email list
 *                                   (also the one-click List-Unsubscribe target)
 * The token is random per email; it reveals nothing about the guest.
 * Token 'preview' (dashboard previews) redirects without counting.
 */
const HOME = 'https://italianbearchocolate.com/';
const BOT_UA = /(bot|spider|crawl|preview|scan|proofpoint|mimecast|barracuda|safelinks|python|curl|wget|headless|go-http|java\/|okhttp)/i;

type Ctx = { params: Promise<{ token: string; link: string }> };

async function findRow(token: string) {
  if (!/^[a-f0-9]{16,64}$/.test(token)) return null;
  const { data } = await supabaseAdmin().from('visit_emails').select('id, shop, email').eq('token', token).maybeSingle();
  return data;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { token, link } = await ctx.params;
  if (link === 'unsubscribe') return page(token, false);

  const s = await loadSettings();
  const l = findLink(s, link);
  if (token === 'preview') {
    const shop = req.nextUrl.searchParams.get('shop') ?? 'soho';
    return NextResponse.redirect(l ? destinationUrl(l, shop, s) || HOME : HOME, 302);
  }
  const row = await findRow(token);
  const dest = l && row ? destinationUrl(l, row.shop, s) : '';
  if (row) {
    const ua = req.headers.get('user-agent') ?? '';
    await supabaseAdmin().from('visit_email_clicks').insert({
      visit_email_id: row.id, link_key: l ? l.key : `unknown:${link.slice(0, 30)}`, likely_bot: !ua || BOT_UA.test(ua),
    });
  }
  return NextResponse.redirect(dest || HOME, 302);
}

export async function HEAD() {
  // Link scanners often send HEAD first: answer without counting anything.
  return new NextResponse(null, { status: 200 });
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { token, link } = await ctx.params;
  if (link !== 'unsubscribe') return new NextResponse('Not found', { status: 404 });
  const row = token === 'preview' ? null : await findRow(token);
  if (row?.email) {
    const db = supabaseAdmin();
    await db.from('visit_email_suppressions').upsert({ email: row.email, reason: 'opt_out' }, { onConflict: 'email', ignoreDuplicates: true });
    await db.from('visit_emails').update({ state: 'cancelled', skip_reason: 'opted_out', email: null, first_name: null })
      .eq('email', row.email).eq('state', 'queued');
  }
  return page(token, true);
}

function page(token: string, done: boolean) {
  const safe = token.replace(/[^a-z0-9]/gi, '');
  const body = done
    ? `<h1>You won't hear from us again</h1><p>We've removed your address from our thank-you emails. Sorry to have bothered you.</p>`
    : `<h1>Stop emails from Italian Bear Chocolate?</h1><p>Press the button and we won't send you this kind of email again.</p>
       <form method="post" action="/r/${safe}/unsubscribe"><button type="submit">Yes, don't email me again</button></form>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Italian Bear Chocolate</title>
<style>body{margin:0;background:#f8f1e6;color:#2c1b14;font:16px/1.55 Arial,Helvetica,sans-serif;padding:40px 16px}
main{max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:28px}h1{font:normal 24px/1.25 Georgia,serif;margin:0 0 12px}
button{font:inherit;font-weight:600;background:#4a2a1d;color:#f8f1e6;border:0;border-radius:999px;padding:12px 22px;cursor:pointer;margin-top:8px}
a{color:#4a2a1d}</style></head><body><main>${body}<p style="margin-top:24px"><a href="${HOME}">italianbearchocolate.com</a></p></main></body></html>`;
  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
