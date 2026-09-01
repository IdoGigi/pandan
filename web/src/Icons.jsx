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
