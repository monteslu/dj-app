/**
 * WebBanner — shown ONLY in the web demo build (window.__DJ_WEB__). A slim bar that (1)
 * upsells the full desktop app, and (2) warns when WebGPU is unavailable (stem separation
 * needs it), linking the help page. Hidden entirely in the Electron app.
 */

import { useState } from 'react';

const IS_WEB = (window as unknown as { __DJ_WEB__?: boolean }).__DJ_WEB__ === true;
const HAS_WEBGPU = 'gpu' in navigator;

export function WebBanner(): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState(false);
  if (!IS_WEB || dismissed) return null;

  return (
    <div className="web-banner">
      {!HAS_WEBGPU && (
        <span className="web-banner-warn">
          ⚠ Your browser doesn&apos;t have WebGPU, so live stem separation is off (the bundled
          demo songs still work).{' '}
          <a href="https://mochamix.org/webgpu" target="_blank" rel="noopener">
            How to enable it
          </a>
          .
        </span>
      )}
      <span className="web-banner-msg">
        This is the in-browser demo. For your full library, folder scanning, and saved
        playlists, install the app: <code>npx mochamix-app</code>
      </span>
      <a className="web-banner-cta" href="https://mochamix.org/download.html" target="_blank" rel="noopener">
        Get the app
      </a>
      <button className="web-banner-x" onClick={() => setDismissed(true)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
