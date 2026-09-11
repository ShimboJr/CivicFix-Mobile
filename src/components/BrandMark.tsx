/**
 * BrandMark — CivicFix logo icon for the mobile app.
 *
 * Ports the web app's favicon.svg pixel-for-pixel into React Native using
 * react-native-svg.  The path data is verbatim from:
 *   client/public/favicon.svg  (Bootstrap Icons bi-building-check, 16×16 viewBox)
 *
 * The SVG is drawn on a 32×32 canvas with:
 *   - A rounded-square background at #0B4F6C (CivicFix web primary — matches favicon)
 *   - The building-check glyph scaled 1.5× and translated (4,4) to sit in a 24×24
 *     area centred within the canvas, exactly as in the web favicon.
 *
 * Pass `size` to scale the rendered icon uniformly (default 64 for the login screen).
 * The internal viewBox is always 32×32 so path data never needs to change.
 */

import Svg, { Rect, G, Path } from 'react-native-svg';

interface BrandMarkProps {
  /** Rendered width & height in dp.  Aspect ratio is always 1:1. */
  size?: number;
}

export default function BrandMark({ size = 64 }: BrandMarkProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      // No accessible role needed — purely decorative; the parent labels the logo.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* Rounded-square background — #0B4F6C matches web favicon exactly */}
      <Rect width="32" height="32" rx="7" ry="7" fill="#0B4F6C" />

      {/*
        Glyph: Bootstrap Icons bi-building-check (16×16 viewBox),
        scaled 1.5× and translated (4,4) to fill a 24×24 area inside the canvas.
        Path data verbatim from client/public/favicon.svg.
      */}
      <G transform="translate(4,4) scale(1.5)" fill="#ffffff">
        {/* Check badge */}
        <Path d="M12.5 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7m1.679-4.493-1.335 2.226a.75.75 0 0 1-1.174.144l-.774-.773a.5.5 0 0 1 .708-.708l.547.548 1.17-1.951a.5.5 0 1 1 .858.514" />
        {/* Building outline */}
        <Path d="M2 1a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6.5a.5.5 0 0 1-1 0V1H3v14h3v-2.5a.5.5 0 0 1 .5-.5H8v4H3a1 1 0 0 1-1-1z" />
        {/* Window grid */}
        <Path d="M4.5 2a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm-6 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm-6 3a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5zm3 0a.5.5 0 0 0-.5.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5z" />
      </G>
    </Svg>
  );
}
