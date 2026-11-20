import { useEffect, useState } from 'react';
import { Logo } from './Logo';

/** App-open splash: animated logo, auto-dismisses. Shows once per launch. */
export function Splash() {
  const [visible, setVisible] = useState(true);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const hold = window.setTimeout(() => setLeaving(true), 1100);
    const gone = window.setTimeout(() => setVisible(false), 1450);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(gone);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[80] flex flex-col items-center justify-center gap-4 bg-base-0 transition-opacity duration-300 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      aria-hidden="true"
    >
      <div className="splash-ring flex size-24 items-center justify-center">
        <Logo size={88} spin />
      </div>
      <p className="splash-text text-sm font-semibold tracking-wide">OmniPix Studio</p>
      <div className="splash-bar h-1 w-40 overflow-hidden rounded-full bg-base-2">
        <span className="block h-full w-1/2 rounded-full bg-accent" />
      </div>
    </div>
  );
}
