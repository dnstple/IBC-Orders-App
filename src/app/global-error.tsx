'use client';

/** Last-resort boundary (errors in the root layout itself). */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  console.error('[global error boundary]', error);
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: 'system-ui', background: '#faf8f5', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ color: '#2b1d12' }}>Something went wrong</h1>
          <p style={{ color: '#78716c' }}>Your orders are safe in Shopify.</p>
          <button onClick={reset} style={{ minHeight: 44, padding: '10px 20px', borderRadius: 12, background: '#4a3220', color: '#fff', border: 0, marginRight: 8, cursor: 'pointer' }}>Try again</button>
          <button onClick={() => window.location.reload()} style={{ minHeight: 44, padding: '10px 20px', borderRadius: 12, background: '#fff', border: '1px solid #d6d3d1', cursor: 'pointer' }}>Refresh page</button>
        </div>
      </body>
    </html>
  );
}
