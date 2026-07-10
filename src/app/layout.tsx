import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Italian Bear Orders',
  description: 'Internal order operations dashboard — Italian Bear Chocolate',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'IBC Orders' },
};

export const viewport: Viewport = {
  themeColor: '#faf8f5',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <head>
        {/* Compatibility shim for iPadOS 12 (Safari 12): globalThis is
            missing there but required by the data-client libraries. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              // ES5-only: must parse on the oldest Safari. Reports the first
              // global error (incl. syntax errors in chunks, which React
              // boundaries never see) to /api/client-error.
              "window.globalThis=window.globalThis||window;" +
              "(function(){var sent=false;function report(m,st){if(sent)return;sent=true;try{var x=new XMLHttpRequest();x.open('POST','/api/client-error',true);x.setRequestHeader('Content-Type','application/json');x.send(JSON.stringify({message:'[global] '+m,stack:st||'',url:location.href}));}catch(e){}}" +
              "window.onerror=function(msg,src,line,col,err){report(String(msg),(err&&err.stack)||String(src)+':'+line+':'+col);};" +
              "window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;report(r&&r.message?r.message:String(r),(r&&r.stack)||'');});})();",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
