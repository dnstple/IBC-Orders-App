/**
 * Builds the thank-you email (HTML + plain text) from the dashboard copy.
 * Every link goes through /r/<token>/<link key> so clicks are counted, and
 * the final destination carries UTM tags so Shopify's reports show the
 * visits and sales the email brought in.
 */
import { SHOPS, shopName, type Shop, type VisitEmailLink, type VisitEmailSettings } from './settings';

export interface RenderInput {
  token: string;            // the row's token, or 'preview'
  appUrl: string;           // e.g. https://ibc-orders.vercel.app
  shop: string;
  firstName: string;
  visitDate: string;        // YYYY-MM-DD
  variant: 'marketing' | 'plain';
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  links: Array<{ key: string; label: string; trackedUrl: string; destination: string }>;
  optOutUrl: string | null;
  /** Links left out because they have no address yet (fix these before going live). */
  missingLinks: string[];
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function niceDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** Fills {first_name} {shop} {visit_day}. With no first name, ", {first_name}" disappears cleanly. */
export function fill(template: string, vars: { firstName: string; shop: string; visitDate: string }): string {
  const name = vars.firstName.trim();
  let t = template;
  if (!name) t = t.replace(/[,\s]*\{first_name\}/g, '');
  return t
    .replace(/\{first_name\}/g, name)
    .replace(/\{shop\}/g, shopName(vars.shop))
    .replace(/\{visit_day\}/g, niceDay(vars.visitDate));
}

/** Where a link really goes for a given café, with UTM tags added. '' if not set. */
export function destinationUrl(link: VisitEmailLink, shop: string, s: VisitEmailSettings): string {
  const base = (link.shop_urls?.[shop as Shop] || link.url || '').trim();
  if (!base) return '';
  let u: URL;
  try { u = new URL(base); } catch { return ''; }
  // Only tag our own site; review sites (Google etc.) get the plain link.
  if (/(^|\.)italianbearchocolate\.com$/i.test(u.hostname)) {
    u.searchParams.set('utm_source', s.utm_source);
    u.searchParams.set('utm_medium', s.utm_medium);
    u.searchParams.set('utm_campaign', s.utm_campaign);
    u.searchParams.set('utm_content', `${link.key}-${shop}`);
  }
  return u.toString();
}

export function linksFor(variant: 'marketing' | 'plain', s: VisitEmailSettings): VisitEmailLink[] {
  return s.links.filter((l) => l.show_in === 'all' || variant === 'marketing');
}

export function renderEmail(s: VisitEmailSettings, input: RenderInput): RenderedEmail {
  const vars = { firstName: input.firstName, shop: input.shop, visitDate: input.visitDate };
  const base = input.appUrl.replace(/\/+$/, '');
  const subject = fill(s.subject, vars).replace(/\s+/g, ' ').trim();
  const heading = fill(s.heading, vars).trim();
  const preheader = fill(s.preheader, vars).trim();
  const body = fill(input.variant === 'marketing' ? s.body_marketing : s.body_plain, vars);
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const signoff = fill(s.signoff, vars).trim();

  const links: RenderedEmail['links'] = [];
  const missingLinks: string[] = [];
  for (const l of linksFor(input.variant, s)) {
    const destination = destinationUrl(l, input.shop, s);
    if (!destination) { missingLinks.push(l.label); continue; }
    links.push({ key: l.key, label: l.label, destination, trackedUrl: `${base}/r/${input.token}/${l.key}` });
  }
  const optOutUrl = s.include_opt_out ? `${base}/r/${input.token}/unsubscribe` : null;

  const shopInfo = SHOPS.find((x) => x.key === input.shop);
  const cocoa = '#4a2a1d', cream = '#f8f1e6', ink = '#2c1b14', muted = '#7a5f50';

  const buttons = links
    .map((l, i) =>
      `<tr><td style="padding:${i ? 10 : 6}px 0 0"><a href="${esc(l.trackedUrl)}" style="display:inline-block;background:${i === 0 ? cocoa : '#ffffff'};color:${i === 0 ? cream : cocoa};border:1px solid ${cocoa};border-radius:999px;padding:12px 22px;font-weight:600;font-size:15px;text-decoration:none">${esc(l.label)}</a></td></tr>`)
    .join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:${cream}">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${cream}"><tr><td align="center" style="padding:28px 14px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;font-family:Georgia,'Times New Roman',serif;color:${ink}">
<tr><td style="background:${cocoa};border-radius:14px 14px 0 0;padding:22px 28px;color:${cream};font-size:20px;letter-spacing:.04em;text-align:center">Italian Bear Chocolate</td></tr>
<tr><td style="padding:28px 28px 8px">
<h1 style="margin:0 0 16px;font-size:24px;font-weight:normal;line-height:1.25">${esc(heading)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55">${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')}
${buttons ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 6px;font-family:Arial,Helvetica,sans-serif">${buttons}</table>` : ''}
<p style="margin:20px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55">${esc(signoff).replace(/\n/g, '<br>')}</p>
</td></tr>
<tr><td style="padding:18px 28px 26px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:${muted}">
Italian Bear Chocolate ${esc(shopInfo?.name ?? '')}${shopInfo ? ', ' + esc(shopInfo.address) : ''}<br>
You're getting this one-off email because you visited us recently.${optOutUrl ? ` <a href="${esc(optOutUrl)}" style="color:${muted}">Don't email me again</a>` : ''}
</td></tr>
</table></td></tr></table>
</body></html>`;

  const text = [
    heading,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...links.map((l) => `${l.label}: ${l.trackedUrl}`),
    links.length ? '' : null,
    signoff,
    '',
    `Italian Bear Chocolate ${shopInfo?.name ?? ''}${shopInfo ? ', ' + shopInfo.address : ''}`,
    "You're getting this one-off email because you visited us recently.",
    optOutUrl ? `Don't email me again: ${optOutUrl}` : null,
  ].filter((x) => x !== null).join('\n');

  return { subject, html, text, links, optOutUrl, missingLinks };
}
