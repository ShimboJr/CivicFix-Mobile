/**
 * BrandMark — CivicFix logo icon for the mobile app.
 *
 * Renders the current app icon as a scalable SVG using react-native-svg.
 * The design features:
 *   - Deep-teal rounded-square background  (#1A5F7A — matches app icon bg)
 *   - A white location-pin glyph centred in the canvas
 *   - Two concentric signal-arc rings (white) flanking the pin
 *   - Two amber accent dots (#C8860A) at the top of the arcs
 *
 * All geometry is hand-traced from the official icon asset so that the mark
 * stays pixel-perfect at every size without bitmap blurring.
 *
 * Pass `size` to scale the rendered icon uniformly (default 72 for the login
 * screen). The internal viewBox is always 100×100 so path data never needs
 * to change.
 */

import Svg, { Rect, Path, Circle, G } from 'react-native-svg';

interface BrandMarkProps {
  /** Rendered width & height in dp.  Aspect ratio is always 1:1. */
  size?: number;
}

export default function BrandMark({ size = 72 }: BrandMarkProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {/* ── Background: deep-teal rounded square ── */}
      <Rect
        width="100"
        height="100"
        rx="22"
        ry="22"
        fill="#1A5F7A"
      />

      {/*
        ── Outer signal arc (left) ──
        A thick arc that curves from ~200° to ~340° (left side).
        Drawn as a wide-stroke path with rounded linecaps.
      */}
      <G fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round">
        {/* Left outer arc */}
        <Path d="M 24,52 A 28,28 0 0,1 50,24" />
        {/* Right outer arc */}
        <Path d="M 76,52 A 28,28 0 0,0 50,24" />

        {/* Left inner arc */}
        <Path d="M 31,56 A 21,21 0 0,1 50,35" />
        {/* Right inner arc */}
        <Path d="M 69,56 A 21,21 0 0,0 50,35" />
      </G>

      {/*
        ── Location pin ──
        Classic teardrop shape: rounded top, sharp bottom point.
        Centred at x=50, the pin top circle is around y=47, point at y=76.
      */}
      <Path
        d="
          M 50 34
          C 40 34, 33 41, 33 50
          C 33 60, 46 73, 50 77
          C 54 73, 67 60, 67 50
          C 67 41, 60 34, 50 34
          Z
        "
        fill="#FFFFFF"
      />

      {/* Teal inner circle — the "hole" of the location pin */}
      <Circle cx="50" cy="49" r="9" fill="#1A8FA0" />

      {/*
        ── Amber accent dots ──
        Sit at the open tips of the outer signal arcs.
        Left dot ~  (29, 27),  right dot ~ (71, 27)
      */}
      <Circle cx="30" cy="27" r="6.5" fill="#C8860A" />
      <Circle cx="70" cy="27" r="6.5" fill="#C8860A" />
    </Svg>
  );
}
