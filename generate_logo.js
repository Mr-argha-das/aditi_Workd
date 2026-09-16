const fs = require('fs');
const { execSync } = require('child_process');

// In 1000x1000 coordinate system:
// Let's create the master SVG with all precise gradients, drop-shadows, paths, and typography

function buildSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" width="1000" height="1000" fill="none">
  <defs>
    <!-- Background Ambient Glow -->
    <radialGradient id="ambientGlow" cx="50%" cy="38%" r="45%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.22"/>
      <stop offset="35%" stop-color="#4f46e5" stop-opacity="0.14"/>
      <stop offset="60%" stop-color="#9333ea" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Arrow Specular Glow -->
    <radialGradient id="arrowTipGlow" cx="740" cy="235" r="140" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/>
      <stop offset="50%" stop-color="#818cf8" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Filter for Soft Dropshadows -->
    <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="-4" dy="8" stdDeviation="12" flood-color="#000000" flood-opacity="0.6"/>
    </filter>

    <filter id="foldShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="8" dy="12" stdDeviation="10" flood-color="#020617" flood-opacity="0.85"/>
    </filter>

    <filter id="pillarShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="-6" dy="-6" stdDeviation="8" flood-color="#020617" flood-opacity="0.7"/>
    </filter>

    <!-- 1. Bar 1 Gradient (Leftmost) -->
    <linearGradient id="bar1Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="40%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>

    <!-- 2. Bar 2 Gradient (Middle) -->
    <linearGradient id="bar2Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="30%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#4f46e5"/>
    </linearGradient>

    <!-- 3. Bar 3 Gradient (Rightmost bar) -->
    <linearGradient id="bar3Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="35%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#6366f1"/>
    </linearGradient>

    <!-- 4. Left Outer Arch (Upper fold) -->
    <linearGradient id="leftArchGrad" x1="0%" y1="100%" x2="70%" y2="0%">
      <stop offset="0%" stop-color="#00e5ff"/>
      <stop offset="30%" stop-color="#38bdf8"/>
      <stop offset="70%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>

    <!-- 5. Left Downward Fold (Inner underside) -->
    <linearGradient id="leftInnerFoldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2563eb"/>
      <stop offset="45%" stop-color="#1d4ed8"/>
      <stop offset="85%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- 6. Ascending Arrow Shaft -->
    <linearGradient id="arrowShaftGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="25%" stop-color="#3b82f6"/>
      <stop offset="60%" stop-color="#6366f1"/>
      <stop offset="85%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#a78bfa"/>
    </linearGradient>

    <!-- 7. Center V-Fold Turn -->
    <linearGradient id="centerVTurnGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#60a5fa"/>
      <stop offset="50%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1d4ed8"/>
    </linearGradient>

    <!-- 8. Right Column (Under arrow) -->
    <linearGradient id="rightColGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="30%" stop-color="#6366f1"/>
      <stop offset="65%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>

    <!-- 9. Arrow Head Light / Specular Facet (Left side) -->
    <linearGradient id="arrowHeadFacetLight" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="40%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#c7d2fe"/>
    </linearGradient>

    <!-- 10. Arrow Head Dark / Base Facet (Right side) -->
    <linearGradient id="arrowHeadFacetDark" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="50%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#a855f7"/>
    </linearGradient>

    <!-- 11. Text "Matrix" Gradient -->
    <linearGradient id="matrixTextGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="20%" stop-color="#3b82f6"/>
      <stop offset="45%" stop-color="#6366f1"/>
      <stop offset="70%" stop-color="#a855f7"/>
      <stop offset="90%" stop-color="#c084fc"/>
      <stop offset="100%" stop-color="#d946ef"/>
    </linearGradient>

    <!-- 12. Text Glow -->
    <filter id="whiteGlow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#ffffff" flood-opacity="0.25"/>
    </filter>
  </defs>

  <!-- Solid Deep Black Background -->
  <rect width="1000" height="1000" fill="#000000"/>

  <!-- Radial Backglow -->
  <circle cx="500" cy="380" r="380" fill="url(#ambientGlow)"/>
  <circle cx="740" cy="235" r="140" fill="url(#arrowTipGlow)"/>

  <!-- ==================== ICON MARK (CENTERED) ==================== -->
  <g id="icon-mark">
    <!-- 1. Lower Left Growth Bar 1 (Shortest) -->
    <rect x="340" y="476" width="32" height="58" rx="16" fill="url(#bar1Grad)"/>

    <!-- 2. Lower Left Growth Bar 2 (Middle) -->
    <rect x="386" y="450" width="32" height="84" rx="16" fill="url(#bar2Grad)"/>

    <!-- 3. Lower Left Growth Bar 3 (Tallest) -->
    <rect x="432" y="420" width="32" height="114" rx="16" fill="url(#bar3Grad)"/>

    <!-- 4. Right Vertical Pillar (Tucked under arrow shaft) -->
    <!-- Starts under arrow at top-right, extends down to baseline with rounded bottom -->
    <path d="M 588 358
             L 662 300
             L 662 486
             A 22 22 0 0 1 640 508
             L 610 534
             A 22 22 0 0 1 588 518
             Z"
          fill="url(#rightColGrad)"
          filter="url(#pillarShadow)"/>

    <!-- 5. Folded Left Ribbon - Inner Downward Fold (Underside facet) -->
    <!-- Folds from the left arch peak down into the center V-dip -->
    <path d="M 400 286
             L 486 352
             L 538 466
             L 468 408
             Z"
          fill="url(#leftInnerFoldGrad)"
          filter="url(#foldShadow)"/>

    <!-- 6. Left Outer Arch (Upper face of M) -->
    <!-- Outer vertical leg rounding over the shoulder and down into the fold -->
    <path d="M 340 455
             L 340 318
             A 38 38 0 0 1 378 280
             L 404 280
             A 38 38 0 0 1 436 298
             L 538 466
             L 492 488
             L 396 348
             L 340 455
             Z"
          fill="url(#leftArchGrad)"
          filter="url(#softShadow)"/>

    <!-- 7. Ascending Arrow Shaft (Center V-dip up to arrow head) -->
    <!-- Begins at center valley, rises up and right at 45 degrees -->
    <path d="M 488 474
             L 538 466
             L 678 300
             L 628 260
             L 492 422
             Z"
          fill="url(#arrowShaftGrad)"
          filter="url(#softShadow)"/>

    <!-- 8. Center V-dip Bevel highlight / curved bottom cap -->
    <path d="M 488 474
             A 18 18 0 0 0 514 484
             L 538 466
             L 492 422
             A 18 18 0 0 0 472 444
             Z"
          fill="url(#centerVTurnGrad)"/>

    <!-- 9. The Arrow Head -->
    <!-- Left barb at (590, 275), Tip at (736, 178), Right barb at (746, 312), Notch at (666, 268) -->
    <!-- Facet A: Upper Specular Half -->
    <path d="M 590 276
             L 736 178
             L 666 268
             Z"
          fill="url(#arrowHeadFacetLight)"/>

    <!-- Facet B: Lower Violet Half -->
    <path d="M 736 178
             L 746 312
             L 666 268
             Z"
          fill="url(#arrowHeadFacetDark)"/>
  </g>

  <!-- ==================== TYPOGRAPHY ==================== -->
  <!-- "IndexMatrix" Logotype -->
  <g id="logotype" font-family="'Outfit', 'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif" font-weight="800">
    <!-- "Index" in Brilliant Solid White -->
    <text x="180" y="700" font-size="116" fill="#ffffff" letter-spacing="-0.02em" filter="url(#whiteGlow)">Index</text>

    <!-- "Matrix" in Vibrant Continuous Gradient -->
    <text x="495" y="700" font-size="116" fill="url(#matrixTextGrad)" letter-spacing="-0.02em">Matrix</text>
  </g>

  <!-- "SUBMIT • INDEX • GROW" Subtitle Tagline -->
  <text x="500" y="780"
        text-anchor="middle"
        font-family="'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif"
        font-weight="600"
        font-size="22"
        fill="#94a3b8"
        letter-spacing="0.42em">SUBMIT  •  INDEX  •  GROW</text>
</svg>
`;
}

fs.writeFileSync('/tmp/test_logo.svg', buildSvg());
console.log('Written /tmp/test_logo.svg');
