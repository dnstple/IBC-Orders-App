/**
 * Black-and-white Italian Bear Chocolate logo for the thermal printer,
 * redrawn from the colour logo (docs/brand/ibc-logo-colour.jpg) rather than
 * thresholded: ITALIAN in black on white; BEAR and CHOCOLATE in white on
 * black panels split by a thin white line; small straight white notches on
 * the BEAR panel's sides; a plain rectangular border. Lettering is set in
 * Oswald (the site's heading face) and squeezed to the logo's widths so it
 * stands tall. Proportions follow the colour logo, scaled 884 → 220.
 */
export const SLIP_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" role="img" aria-label="Italian Bear Chocolate">
  <rect x="1.5" y="1.5" width="217" height="217" fill="#fff" stroke="#000" stroke-width="3"/>
  <text x="110" y="61" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-weight="500" font-size="50" textLength="104" lengthAdjust="spacingAndGlyphs" fill="#000">ITALIAN</text>
  <rect x="9" y="74" width="202" height="68" fill="#000"/>
  <rect x="9" y="104.5" width="12" height="5.5" fill="#fff"/>
  <rect x="199" y="104.5" width="12" height="5.5" fill="#fff"/>
  <text x="110" y="128.5" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-weight="500" font-size="45" textLength="68" lengthAdjust="spacingAndGlyphs" fill="#fff">BEAR</text>
  <rect x="9" y="144.5" width="202" height="66.5" fill="#000"/>
  <text x="110" y="198.5" text-anchor="middle" font-family="Oswald, 'Arial Narrow', sans-serif" font-weight="500" font-size="46" textLength="152" lengthAdjust="spacingAndGlyphs" fill="#fff">CHOCOLATE</text>
</svg>`;
