/**
 * Builds the thank-you email (HTML + plain text) from the dashboard copy.
 * Every link goes through /r/<token>/<link key> so clicks are counted, and
 * the final destination carries UTM tags so Shopify's reports show the
 * visits and sales the email brought in.
 *
 * Copy can use two bits of markup:
 *   **bold words**            -> bold
 *   [link words](https://...) -> a link (tracked like the buttons, key "t-<hash>")
 *
 * Fonts match the website (Oswald headings, Cabin body). The name (League
 * Gothic) and the closing line (Cookie) are images drawn in the real fonts by
 * /r/img/..., because Gmail and Outlook ignore web fonts; their alt text is
 * styled to look close if images are blocked.
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

const ymdDate = (ymd: string) => new Date(`${ymd}T12:00:00Z`);

/** "Wednesday" */
export function weekday(ymd: string): string {
  const d = ymdDate(ymd);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
}

/** "Wednesday 11 November" */
export function niceDay(ymd: string): string {
  const d = ymdDate(ymd);
  if (Number.isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/**
 * Fills {first_name} {shop} {visit_day} (Wednesday) {visit_date} (Wednesday 11 November).
 * With no first name, ", {first_name}" disappears cleanly.
 */
export function fill(template: string, vars: { firstName: string; shop: string; visitDate: string }): string {
  const name = vars.firstName.trim();
  let t = template;
  if (!name) t = t.replace(/[,\s]*\{first_name\}/g, '');
  return t
    .replace(/\{first_name\}/g, name)
    .replace(/\{shop\}/g, shopName(vars.shop))
    .replace(/\{visit_day\}/g, weekday(vars.visitDate))
    .replace(/\{visit_date\}/g, niceDay(vars.visitDate));
}

/* ---------------- inline markup ---------------- */

const MARKUP = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g;

/** Short stable id for an inline link's address, used as its report key ("t-xxxxxxx"). */
export function inlineKey(url: string): string {
  let h = 5381;
  for (let i = 0; i < url.length; i++) h = ((h << 5) + h + url.charCodeAt(i)) >>> 0;
  return 't-' + h.toString(36).padStart(7, '0').slice(-7);
}

/** Every [text](url) link in the copy, so /r/ can redirect them and reports can name them. */
export function inlineLinks(s: VisitEmailSettings): VisitEmailLink[] {
  const out = new Map<string, VisitEmailLink>();
  for (const src of [s.body_marketing, s.body_plain, s.signoff]) {
    for (const m of src.matchAll(MARKUP)) {
      if (!m[3]) continue;
      const key = inlineKey(m[3]);
      if (!out.has(key)) out.set(key, { key, label: m[2], url: m[3], show_in: 'all' });
    }
  }
  return [...out.values()];
}

/** Removes markup, for subjects and headings. */
export function stripMarkup(t: string): string {
  return t.replace(MARKUP, (_m, b, lt) => b ?? lt ?? '');
}

function markupToHtml(text: string, linkHtml: (label: string, url: string) => string): string {
  let out = '', last = 0;
  for (const m of text.matchAll(MARKUP)) {
    out += esc(text.slice(last, m.index));
    out += m[1] !== undefined ? `<strong>${esc(m[1])}</strong>` : linkHtml(m[2], m[3]);
    last = (m.index ?? 0) + m[0].length;
  }
  return (out + esc(text.slice(last))).replace(/\n/g, '<br>');
}

function markupToText(text: string, linkText: (label: string, url: string) => string): string {
  return text.replace(MARKUP, (_m, b, lt, url) => (b !== undefined ? b : linkText(lt, url)));
}

/* ---------------- links ---------------- */

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

/** A button or inline link by its key (used by the /r/ redirect). */
export function findLink(s: VisitEmailSettings, key: string): VisitEmailLink | undefined {
  return s.links.find((l) => l.key === key) ?? (key.startsWith('t-') ? inlineLinks(s).find((l) => l.key === key) : undefined);
}

/* ---------------- the email ---------------- */

const C = { dark: '#4b2a1e', milk: '#f8f2ec', cream: '#f1e7df', ink: '#4b2a1e', soft: '#6b5245', line: '#e2d4c8' };
/** Dark-mode colours: deep chocolate background, #F1E7DF text, white brand lettering. */
const D = { bg: '#2e1911', text: '#f1e7df', button: '#fbf2d7', soft: '#cdbcae', line: '#5a3d31' };
/** Bump when the brand-font images change, so inboxes fetch the new ones. */
const IMG_V = 4;
const F = {
  wordmark: "'League Gothic','Oswald','Arial Narrow',Arial,sans-serif",
  display: "'Oswald','Arial Narrow',Arial,sans-serif",
  body: "'Cabin','Gill Sans','Gill Sans MT','Segoe UI',Arial,sans-serif",
  script: "'Cookie','Brush Script MT','Segoe Script',cursive",
};
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Cabin:wght@400;600&family=Cookie&family=League+Gothic&family=Oswald:wght@400;500&display=swap';

export function renderEmail(s: VisitEmailSettings, input: RenderInput): RenderedEmail {
  const vars = { firstName: input.firstName, shop: input.shop, visitDate: input.visitDate };
  const base = input.appUrl.replace(/\/+$/, '');
  const subject = stripMarkup(fill(s.subject, vars)).replace(/\s+/g, ' ').trim();
  const heading = stripMarkup(fill(s.heading, vars)).trim();
  const preheader = stripMarkup(fill(s.preheader, vars)).trim();
  const body = fill(input.variant === 'marketing' ? s.body_marketing : s.body_plain, vars);
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const signoff = fill(s.signoff, vars).trim();
  const tagline = s.tagline.trim();

  const tracked = (key: string) => `${base}/r/${input.token}/${key}`;
  const linkStyle = `color:${C.dark};text-decoration:underline;font-weight:600`;
  const inlineHtml = (label: string, url: string) => `<a href="${esc(tracked(inlineKey(url)))}" style="${linkStyle}">${esc(label)}</a>`;
  const inlineText = (label: string, url: string) => `${label} (${tracked(inlineKey(url))})`;

  const links: RenderedEmail['links'] = [];
  const missingLinks: string[] = [];
  for (const l of linksFor(input.variant, s)) {
    const destination = destinationUrl(l, input.shop, s);
    if (!destination) { missingLinks.push(l.label); continue; }
    links.push({ key: l.key, label: l.label, destination, trackedUrl: tracked(l.key) });
  }
  const optOutUrl = s.include_opt_out ? `${base}/r/${input.token}/unsubscribe` : null;
  const shopInfo = SHOPS.find((x) => x.key === input.shop);

  const p = (html: string, extra = '') =>
    `<p style="margin:0 0 14px;font-family:${F.body};font-size:14px;line-height:1.6;color:${C.ink}${extra}">${html}</p>`;

  const imgStyle = (extra: string) => `border:0;outline:none;max-width:100%;height:auto;${extra}`;
  /** One image for normal inboxes, plus a white one that only dark-mode inboxes show. */
  const pair = (light: string, dark: string) =>
    `<div class="lm">${light}</div><div class="dm" style="display:none;mso-hide:all;max-height:0;overflow:hidden">${dark}</div>`;
  const wordmarkImg = (on: 'dark' | 'light', width: number) => {
    const img = (v: string, colour: string) =>
      `<img src="${esc(base)}/r/img/wordmark?on=${v}&amp;v=${IMG_V}" width="${width}" height="${Math.round(width * 112 / 720)}" alt="Italian Bear Chocolate" style="display:block;${imgStyle(`color:${colour};font-family:${F.wordmark};font-size:${on === 'dark' ? 28 : 22}px;letter-spacing:.06em;text-transform:uppercase`)}">`;
    return on === 'dark' ? img('dark', C.milk) : pair(img('light', C.dark), img('white', '#ffffff'));
  };
  const taglineImg = (width: number, align: 'center' | 'left') => {
    const img = (tone: string, colour: string) =>
      `<img src="${esc(base)}/r/img/tagline?t=${encodeURIComponent(tagline)}${align === 'left' ? '&amp;align=left' : ''}${tone ? `&amp;tone=${tone}` : ''}&amp;v=${IMG_V}" width="${width}" height="${Math.round(width * 132 / 720)}" alt="${esc(tagline)}" style="display:block;${align === 'center' ? 'margin:0 auto;' : ''}${imgStyle(`color:${colour};font-family:${F.script};font-size:30px`)}">`;
    return pair(img('', C.dark), img('white', '#ffffff'));
  };
  const footer = (pad: string) => `<tr><td class="ibc-f ibc-line" style="padding:${pad};border-top:1px solid ${C.line};font-family:${F.body};font-size:12px;line-height:1.5;color:${C.soft}">
Italian Bear Chocolate ${esc(shopInfo?.name ?? '')}${shopInfo ? ', ' + esc(shopInfo.address) : ''}<br>
You're getting this one-off email because you visited us recently.${optOutUrl ? ` <a href="${esc(optOutUrl)}" style="color:${C.soft}">Don't email me again</a>` : ''}
</td></tr>`;
  const head = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<title>${esc(subject)}</title>
<link href="${FONTS_URL}" rel="stylesheet">
<style>
strong{font-weight:600}
@media (prefers-color-scheme: dark){
  .ibc-bg{background:${D.bg}!important}
  .ibc-t,.ibc-t p,.ibc-t a{color:${D.text}!important}
  .ibc-t h1{color:#ffffff!important}
  .ibc-t a.ibc-btn{background:${D.button}!important;color:${C.dark}!important;border-color:${D.button}!important}
  .ibc-f,.ibc-f a{color:${D.soft}!important}
  .ibc-line{border-color:${D.line}!important}
  .lm{display:none!important}
  .dm{display:block!important;max-height:none!important;overflow:visible!important}
}
[data-ogsb] .ibc-bg{background:${D.bg}!important}
[data-ogsc] .ibc-t,[data-ogsc] .ibc-t p,[data-ogsc] .ibc-t a{color:${D.text}!important}
[data-ogsc] .ibc-t h1{color:#ffffff!important}
[data-ogsc] .lm{display:none!important}
[data-ogsc] .dm{display:block!important;max-height:none!important;overflow:visible!important}
</style>
</head>`;
  const hidden = `<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${esc(preheader)}</span>`;

  let html: string;
  if (s.style === 'letter') {
    // A short letter: small wordmark, greeting, paragraphs, one simple button, sign-off.
    const buttons = links
      .map((l) =>
        `<tr><td style="padding:2px 0 12px"><a class="ibc-btn" href="${esc(l.trackedUrl)}" style="display:inline-block;background:${C.dark};color:${C.milk};border-radius:2px;padding:11px 20px;font-family:${F.body};font-weight:600;font-size:15px;text-decoration:none">${esc(l.label)}</a></td></tr>`)
      .join('');
    html = `${head}
<body class="ibc-bg" style="margin:0;padding:0;background:${C.milk}">
${hidden}
<table class="ibc-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.milk}"><tr><td class="ibc-bg" align="center" style="padding:30px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;color:${C.ink}">
<tr><td style="padding:0 0 26px">${wordmarkImg('light', 220)}</td></tr>
<tr><td class="ibc-t">
${heading ? p(esc(heading), ';font-size:17px;font-weight:600') : ''}
${paragraphs.map((x) => p(markupToHtml(x, inlineHtml))).join('\n')}
${buttons ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 6px">${buttons}</table>` : ''}
${p(markupToHtml(signoff, inlineHtml), ';margin-top:18px')}
${tagline ? `<div style="margin:0 0 22px">${taglineImg(260, 'left')}</div>` : ''}
</td></tr>
${footer('16px 0 0')}
</table></td></tr></table>
</body></html>`;
  } else {
    const buttons = links
      .map((l, i) =>
        `<tr><td style="padding:${i ? 10 : 4}px 0 0"><a class="ibc-btn" href="${esc(l.trackedUrl)}" style="display:inline-block;background:${i === 0 ? C.dark : '#ffffff'};color:${i === 0 ? C.milk : C.dark};border:1px solid ${C.dark};border-radius:2px;padding:12px 22px;font-family:${F.display};font-weight:500;font-size:14px;letter-spacing:.08em;text-transform:uppercase;text-decoration:none">${esc(l.label)}</a></td></tr>`)
      .join('');
    html = `${head}
<body class="ibc-bg" style="margin:0;padding:0;background:${C.cream}">
${hidden}
<table class="ibc-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.cream}"><tr><td class="ibc-bg" align="center" style="padding:28px 14px">
<table class="ibc-bg" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.milk};border-radius:2px;color:${C.ink}">
<tr><td align="center" style="background:${C.dark};padding:18px 28px"><div style="width:360px;max-width:100%;margin:0 auto">${wordmarkImg('dark', 360)}</div></td></tr>
<tr><td class="ibc-t" style="padding:30px 28px 8px">
<h1 style="margin:0 0 18px;font-family:${F.display};font-size:26px;font-weight:400;line-height:1.2;letter-spacing:.01em;color:${C.dark}">${esc(heading)}</h1>
${paragraphs.map((x) => p(markupToHtml(x, inlineHtml))).join('\n')}
${buttons ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 8px">${buttons}</table>` : ''}
${p(markupToHtml(signoff, inlineHtml), ';margin-top:22px')}
${tagline ? `<div style="margin:8px 0 4px">${taglineImg(360, 'center')}</div>` : ''}
</td></tr>
${footer('16px 28px 24px')}
</table></td></tr></table>
</body></html>`;
  }

  const text = [
    heading,
    '',
    ...paragraphs.flatMap((x) => [markupToText(x, inlineText), '']),
    ...links.map((l) => `${l.label}: ${l.trackedUrl}`),
    links.length ? '' : null,
    markupToText(signoff, inlineText),
    tagline ? '' : null,
    tagline || null,
    '',
    `Italian Bear Chocolate ${shopInfo?.name ?? ''}${shopInfo ? ', ' + shopInfo.address : ''}`,
    "You're getting this one-off email because you visited us recently.",
    optOutUrl ? `Don't email me again: ${optOutUrl}` : null,
  ].filter((x) => x !== null).join('\n');

  return { subject, html, text, links, optOutUrl, missingLinks };
}
