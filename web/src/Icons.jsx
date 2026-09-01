/**
 * Small inline icons. Drawn rather than typed, because a glyph like ⚙ renders
 * differently on every platform and often looks muddy at this size.
 */
export function Gear({ size = 17 }) {
  // Eight teeth, evenly spaced around the rim.
  const teeth = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {teeth.map((angle) => (
        <rect
          key={angle}
          x="10.9"
          y="1.6"
          width="2.2"
          height="4"
          rx="1.1"
          fill="currentColor"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="7.4" stroke="currentColor" strokeWidth="2.1" />
      <circle cx="12" cy="12" r="2.7" fill="currentColor" />
    </svg>
  );
}

/** A small robot head — used wherever something was done by an agent. */
export function Bot({ size = 13 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {/* antenna */}
      <path d="M12 2.5v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="2.4" r="1.6" fill="currentColor" />
      {/* head */}
      <rect x="3.5" y="6" width="17" height="13" rx="4" stroke="currentColor" strokeWidth="2" />
      {/* eyes */}
      <circle cx="9" cy="12.5" r="1.7" fill="currentColor" />
      <circle cx="15" cy="12.5" r="1.7" fill="currentColor" />
    </svg>
  );
}
