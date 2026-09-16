const fs = require('fs');
const { execSync } = require('child_process');

function generateSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254" fill="none">
  <defs>
    <!-- Background Radial Ambient Glow -->
    <radialGradient id="ambientGlow" cx="50%" cy="40%" r="48%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.20"/>
      <stop offset="35%" stop-color="#4f46e5" stop-opacity="0.12"/>
      <stop offset="65%" stop-color="#9333ea" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Arrow Tip Ambient Glow -->
    <radialGradient id="arrowGlow" cx="863" cy="309" r="180" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.32"/>
      <stop offset="45%" stop-color="#818cf8" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Soft Drop Shadows for 3D Ribbon Layers -->
    <filter id="ribbonShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="-6" dy="10" stdDeviation="12" flood-color="#020410" flood-opacity="0.85"/>
    </filter>

    <filter id="shaftShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="-8" dy="8" stdDeviation="14" flood-color="#010314" flood-opacity="0.9"/>
    </filter>

    <filter id="pillarShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="-4" dy="-4" stdDeviation="10" flood-color="#000000" flood-opacity="0.75"/>
    </filter>

    <filter id="textGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#ffffff" flood-opacity="0.2"/>
    </filter>

    <!-- 1. Bar 1 Gradient (Left, Shortest) -->
    <linearGradient id="bar1Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#56c2f8"/>
      <stop offset="40%" stop-color="#4394f7"/>
      <stop offset="100%" stop-color="#3b76f6"/>
    </linearGradient>

    <!-- 2. Bar 2 Gradient (Middle) -->
    <linearGradient id="bar2Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#4ebbf7"/>
      <stop offset="45%" stop-color="#4384f7"/>
      <stop offset="100%" stop-color="#485cf6"/>
    </linearGradient>

    <!-- 3. Bar 3 Gradient (Tallest) -->
    <linearGradient id="bar3Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#4ec4f6"/>
      <stop offset="40%" stop-color="#4688f7"/>
      <stop offset="100%" stop-color="#5542f2"/>
    </linearGradient>

    <!-- 4. Left Arch Outer Face (Cyan-to-Blue Curved Ribbon) -->
    <linearGradient id="leftArchFace" x1="0%" y1="100%" x2="80%" y2="0%">
      <stop offset="0%" stop-color="#58d5fa"/>
      <stop offset="25%" stop-color="#38bdf8"/>
      <stop offset="60%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>

    <!-- 5. Left Arch Inner Fold / Underside Bevel -->
    <linearGradient id="leftArchBevel" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="40%" stop-color="#1d4ed8"/>
      <stop offset="80%" stop-color="#1e3a8a"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- 6. Left Diagonal Fold Over -->
    <linearGradient id="leftFoldOver" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="50%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#1e40af"/>
    </linearGradient>

    <!-- 7. Ascending Arrow Shaft -->
    <linearGradient id="shaftGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="22%" stop-color="#3b82f6"/>
      <stop offset="55%" stop-color="#4f46e5"/>
      <stop offset="80%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>

    <!-- 8. Arrow Head - Upper Light Facet -->
    <linearGradient id="arrowLightFacet" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="50%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#bfdbfe"/>
    </linearGradient>

    <!-- 9. Arrow Head - Lower Dark Facet -->
    <linearGradient id="arrowDarkFacet" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="45%" stop-color="#6366f1"/>
      <stop offset="80%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#9333ea"/>
    </linearGradient>

    <!-- 10. Right Column (Tucked under arrow) -->
    <linearGradient id="rightColGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4338ca"/>
      <stop offset="25%" stop-color="#6366f1"/>
      <stop offset="60%" stop-color="#8b5cf6"/>
      <stop offset="90%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>

    <!-- 11. Text "Matrix" Gradient -->
    <linearGradient id="matrixTextGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="20%" stop-color="#3b82f6"/>
      <stop offset="42%" stop-color="#6366f1"/>
      <stop offset="68%" stop-color="#a855f7"/>
      <stop offset="88%" stop-color="#c084fc"/>
      <stop offset="100%" stop-color="#d946ef"/>
    </linearGradient>
  </defs>

  <!-- Deep Black Canvas -->
  <rect width="1254" height="1254" fill="#000000"/>

  <!-- Ambient Lighting Effects -->
  <circle cx="627" cy="480" r="460" fill="url(#ambientGlow)"/>
  <circle cx="863" cy="309" r="180" fill="url(#arrowGlow)"/>

  <!-- ==================== ICON MARK ==================== -->
  <g id="icon-mark">
    <!-- 1. Lower Left Growth Bar 1 (Shortest) -->
    <rect x="424" y="588" width="40" height="73" rx="18" fill="url(#bar1Grad)"/>

    <!-- 2. Lower Left Growth Bar 2 (Middle) -->
    <rect x="481" y="556" width="40" height="105" rx="18" fill="url(#bar2Grad)"/>

    <!-- 3. Lower Left Growth Bar 3 (Tallest) -->
    <rect x="538" y="520" width="40" height="141" rx="18" fill="url(#bar3Grad)"/>

    <!-- 4. Right Vertical Pillar (Tucked under arrow shaft) -->
    <!-- Bounds: X = 735 to 828, Top cut diagonally under arrow, Bottom rounded capsule -->
    <path d="M 735 486
             L 828 395
             L 828 610
             A 28 28 0 0 1 800 638
             L 763 661
             A 28 28 0 0 1 735 636
             Z"
          fill="url(#rightColGrad)"
          filter="url(#pillarShadow)"/>

    <!-- 5. Left Arch - Under-Fold Bevel (Dark underside of the ribbon) -->
    <path d="M 495 347
             L 605 428
             L 666 573
             L 575 480
             Z"
          fill="url(#leftArchBevel)"
          filter="url(#ribbonShadow)"/>

    <!-- 6. Left Arch - Outer Surface Face -->
    <!-- Rises from x=424, over top-left shoulder, down to fold -->
    <path d="M 424 562
             L 424 410
             C 424 372 454 347 495 347
             C 525 347 555 365 580 388
             L 666 573
             L 605 573
             L 495 428
             L 424 562
             Z"
          fill="url(#leftArchFace)"
          filter="url(#ribbonShadow)"/>

    <!-- 7. Ascending Arrow Shaft (Center valley up to arrow head) -->
    <!-- Rises at ~45 degrees with uniform width ~76px -->
    <path d="M 605 573
             L 666 573
             L 838 382
             L 776 332
             L 605 522
             Z"
          fill="url(#shaftGrad)"
          filter="url(#shaftShadow)"/>

    <!-- 8. Center V-Turn Crease / Curved Fold highlight -->
    <path d="M 605 522
             C 605 558 630 573 666 573
             C 638 573 618 556 618 534
             Z"
          fill="#60a5fa"
          opacity="0.85"/>

    <!-- 9. Arrow Head -->
    <!-- Tip: (864, 309), Left barb: (745, 356), Right barb: (868, 442), Notch: (806, 404) -->
    <!-- Facet A: Upper Specular Half -->
    <path d="M 745 356
             L 864 309
             L 806 404
             Z"
          fill="url(#arrowLightFacet)"/>

    <!-- Facet B: Lower Violet Half -->
    <path d="M 864 309
             L 868 442
             L 806 404
             Z"
          fill="url(#arrowDarkFacet)"/>

    <!-- Crisp Specular Ridge Highlight along arrow center spine -->
    <line x1="806" y1="404" x2="864" y2="309" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.65"/>
  </g>

  <!-- ==================== TYPOGRAPHY ==================== -->
  <g id="typography">
    <!-- Embedded Modern Sans Typography for Web Browsers -->
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&amp;display=swap');
      .brand-title {
        font-family: 'Plus Jakarta Sans', 'Outfit', 'Inter', -apple-system, sans-serif;
        font-weight: 800;
        font-size: 130px;
        letter-spacing: -0.025em;
      }
      .brand-tagline {
        font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif;
        font-weight: 600;
        font-size: 26px;
        letter-spacing: 0.40em;
      }
    </style>

    <!-- "Index" in Crisp Solid White with subtle glow -->
    <text x="182" y="818" class="brand-title" fill="#ffffff" filter="url(#textGlow)">Index</text>

    <!-- "Matrix" in Luminous Gradient -->
    <text x="590" y="818" class="brand-title" fill="url(#matrixTextGrad)">Matrix</text>

    <!-- Tagline: "SUBMIT • INDEX • GROW" -->
    <text x="627" y="910" class="brand-tagline" text-anchor="middle" fill="#cbd5e1">SUBMIT  •  INDEX  •  GROW</text>
  </g>
</svg>
`;
}

const svg = generateSvg();
fs.writeFileSync('/tmp/logo_v2.svg', svg);
fs.writeFileSync('/home/hj/Desktop/adii/logo.svg', svg);
console.log('Saved /tmp/logo_v2.svg and /home/hj/Desktop/adii/logo.svg');
