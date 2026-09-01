/**
 * Pandan's panda. Flat shapes only, so it still reads at 16px in a browser tab.
 * `ink` is the dark colour, `face` the light one, so it works on either theme.
 */
export function Logo({ size = 22, ink, face }) {
  // Fall back to CSS tokens so the panda works in day and night mode.
  const dark = ink || 'var(--logo-ink, #2f3437)';
  const light = face || 'var(--logo-face, #ffffff)';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* ears */}
      <circle cx="8.4" cy="9" r="4.6" fill={dark} />
      <circle cx="23.6" cy="9" r="4.6" fill={dark} />

      {/* head */}
      <circle cx="16" cy="18.4" r="11" fill={light} stroke={dark} strokeWidth="1.6" />

      {/* eye patches, tilted inward so it looks friendly rather than cross */}
      <ellipse cx="11.6" cy="16.8" rx="3.5" ry="4.3" fill={dark} transform="rotate(-16 11.6 16.8)" />
      <ellipse cx="20.4" cy="16.8" rx="3.5" ry="4.3" fill={dark} transform="rotate(16 20.4 16.8)" />

      {/* eyes */}
      <circle cx="12.1" cy="17.2" r="1.45" fill={light} />
      <circle cx="19.9" cy="17.2" r="1.45" fill={light} />

      {/* nose and a small smile */}
      <ellipse cx="16" cy="21.4" rx="1.9" ry="1.4" fill={dark} />
      <path
        d="M13.9 23.7c.8.9 1.5 1.3 2.1 1.3s1.3-.4 2.1-1.3"
        stroke={dark}
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}
