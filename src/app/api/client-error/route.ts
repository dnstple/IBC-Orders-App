import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Stores the most recent client-side crash so it can be inspected with a
 * simple SQL query — invaluable for devices where DevTools isn't available
 * (work iPads etc.). Only the latest crash is kept; requires a signed-in
 * session via middleware.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  await supabaseAdmin().from('app_settings').upsert({
    key: 'last_client_error',
    value: {
      at: new Date().toISOString(),
      message: String(body.message ?? '').slice(0, 500),
      stack: String(body.stack ?? '').slice(0, 3000),
      url: String(body.url ?? '').slice(0, 300),
      userAgent: req.headers.get('user-agent') ?? '',
    },
  });
  return NextResponse.json({ ok: true });
}
