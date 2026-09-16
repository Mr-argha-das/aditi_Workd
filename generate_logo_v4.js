const fs = require('fs');
const { execSync } = require('child_process');

function buildFullSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254" fill="none">
  <defs>
    <!-- Background Radial Ambient Glow -->
    <radialGradient id="ambientGlow" cx="50%" cy="40%" r="48%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.22"/>
      <stop offset="35%" stop-color="#4f46e5" stop-opacity="0.14"/>
      <stop offset="65%" stop-color="#9333ea" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Arrow Tip Specular Bloom -->
    <radialGradient id="arrowBloom" cx="864" cy="309" r="160" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.38"/>
      <stop offset="40%" stop-color="#818cf8" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Professional 3D Dropshadow Filters -->
    <filter id="ribbonShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="-6" dy="12" stdDeviation="14" flood-color="#010312" flood-opacity="0.9"/>
    </filter>

    <filter id="shaftShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="-10" dy="12" stdDeviation="16" flood-color="#010210" flood-opacity="0.95"/>
    </filter>

    <filter id="pillarShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="-4" dy="-4" stdDeviation="10" flood-color="#000000" flood-opacity="0.8"/>
    </filter>

    <filter id="textGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="6" flood-color="#ffffff" flood-opacity="0.25"/>
    </filter>

    <!-- 1. Bar 1 Gradient (Shortest, Left) -->
    <linearGradient id="bar1Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#51c0f7"/>
      <stop offset="45%" stop-color="#4ea9f8"/>
      <stop offset="100%" stop-color="#5184f7"/>
    </linearGradient>

    <!-- 2. Bar 2 Gradient (Middle) -->
    <linearGradient id="bar2Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#53beec"/>
      <stop offset="45%" stop-color="#4f94fb"/>
      <stop offset="100%" stop-color="#4d5bf9"/>
    </linearGradient>

    <!-- 3. Bar 3 Gradient (Tallest) -->
    <linearGradient id="bar3Grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#55caf5"/>
      <stop offset="40%" stop-color="#4f89f7"/>
      <stop offset="100%" stop-color="#4f46f7"/>
    </linearGradient>

    <!-- 4. Left Arch Front Face (Luminous Cyan to Royal Blue) -->
    <linearGradient id="leftArchFace" x1="0%" y1="100%" x2="70%" y2="0%">
      <stop offset="0%" stop-color="#60d5fa"/>
      <stop offset="25%" stop-color="#38bdf8"/>
      <stop offset="65%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>

    <!-- 5. Left Arch Inner Underside (Royal Blue into Valley) -->
    <linearGradient id="leftArchBevel" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="35%" stop-color="#2563eb"/>
      <stop offset="70%" stop-color="#1d4ed8"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- 6. Ascending Arrow Shaft (Cyan-Blue to Indigo to Violet) -->
    <linearGradient id="shaftGrad" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="22%" stop-color="#3b82f6"/>
      <stop offset="55%" stop-color="#4f46e5"/>
      <stop offset="80%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>

    <!-- 7. Arrow Head - Upper Light / Specular Facet -->
    <linearGradient id="arrowLightFacet" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="50%" stop-color="#60a5fa"/>
      <stop offset="100%" stop-color="#bfdbfe"/>
    </linearGradient>

    <!-- 8. Arrow Head - Lower Dark / Violet Facet -->
    <linearGradient id="arrowDarkFacet" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4f46e5"/>
      <stop offset="45%" stop-color="#6366f1"/>
      <stop offset="80%" stop-color="#7c3aed"/>
      <stop offset="100%" stop-color="#9333ea"/>
    </linearGradient>

    <!-- 9. Right Pillar (Royal to Vibrant Orchid Purple) -->
    <linearGradient id="rightColGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4461fa"/>
      <stop offset="30%" stop-color="#6264f7"/>
      <stop offset="65%" stop-color="#8072f9"/>
      <stop offset="90%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>

    <!-- 10. Text "Matrix" Gradient -->
    <linearGradient id="matrixTextGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="22%" stop-color="#3b82f6"/>
      <stop offset="45%" stop-color="#6366f1"/>
      <stop offset="70%" stop-color="#a855f7"/>
      <stop offset="90%" stop-color="#c084fc"/>
      <stop offset="100%" stop-color="#d946ef"/>
    </linearGradient>
  </defs>

  <!-- Solid Deep Void Black Canvas -->
  <rect width="1254" height="1254" fill="#000000"/>

  <!-- Ambient Light Backdrops -->
  <circle cx="627" cy="480" r="460" fill="url(#ambientGlow)"/>
  <circle cx="864" cy="309" r="160" fill="url(#arrowBloom)"/>

  <!-- ==================== ICON MARK ==================== -->
  <g id="icon-mark">
    <!-- 1. Lower Left Growth Bar 1 (Shortest: width 40, height 73) -->
    <rect x="424" y="588" width="40" height="73" rx="18" fill="url(#bar1Grad)"/>

    <!-- 2. Lower Left Growth Bar 2 (Middle: width 40, height 105) -->
    <rect x="481" y="556" width="40" height="105" rx="18" fill="url(#bar2Grad)"/>

    <!-- 3. Lower Left Growth Bar 3 (Tallest: width 40, height 141) -->
    <rect x="538" y="520" width="40" height="141" rx="18" fill="url(#bar3Grad)"/>

    <!-- 4. Right Vertical Pillar (Tucked under arrow shaft) -->
    <!-- Bounds: X = 735 to 828. Top cut parallel to arrow shaft (45°), bottom rounded capsule -->
    <path d="M 735 478
             L 828 396
             L 828 633
             A 28 28 0 0 1 800 661
             L 763 661
             A 28 28 0 0 1 735 633
             Z"
          fill="url(#rightColGrad)"
          filter="url(#pillarShadow)"/>

    <!-- 5. Left Arch - Under-Fold Bevel (Underside of the ribbon) -->
    <!-- Folds from top shoulder down into the center V-dip -->
    <path d="M 495 347
             C 530 347 560 365 595 395
             L 666 573
             L 535 465
             Z"
          fill="url(#leftArchBevel)"
          filter="url(#ribbonShadow)"/>

    <!-- 6. Left Arch - Front Surface Face (Curved Cyan-Blue Ribbon) -->
    <!-- Starts at (424, 567), up to (424, 395), curves over top shoulder, slopes to (535, 465) -->
    <path d="M 424 567
             L 424 395
             C 424 358 455 347 495 347
             L 535 465
             L 424 567
             Z"
          fill="url(#leftArchFace)"
          filter="url(#ribbonShadow)"/>

    <!-- 7. Ascending Arrow Shaft (Center V-dip up to arrow head) -->
    <!-- Rises at ~45° from valley (666, 573) to notch (806, 404), width ~76px -->
    <path d="M 608 525
             C 615 565 640 573 666 573
             L 806 404
             L 748 356
             Z"
          fill="url(#shaftGrad)"
          filter="url(#shaftShadow)"/>

    <!-- 8. Center V-Turn Crease Highlight -->
    <path d="M 608 525
             C 615 562 638 573 666 573
             C 642 573 624 558 620 534
             Z"
          fill="#60a5fa"
          opacity="0.9"/>

    <!-- 9. Arrow Head -->
    <!-- Tip: (864, 309), Left barb: (745, 356), Right barb: (868, 442), Central Notch: (806, 404) -->
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

    <!-- Central 3D Ridge Highlight along arrow spine -->
    <line x1="806" y1="404" x2="864" y2="309" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.75"/>
  </g>

  <!-- ==================== TYPOGRAPHY ==================== -->
  <g id="typography">
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700;800&amp;display=swap');
      .brand-title {
        font-family: 'Plus Jakarta Sans', 'Outfit', 'Inter', -apple-system, sans-serif;
        font-weight: 800;
        font-size: 132px;
        letter-spacing: -0.025em;
      }
      .brand-tagline {
        font-family: 'Plus Jakarta Sans', 'Inter', -apple-system, sans-serif;
        font-weight: 600;
        font-size: 26px;
        letter-spacing: 0.38em;
      }
    </style>

    <!-- "Index" in Brilliant Solid White with subtle glow -->
    <text x="182" y="818" class="brand-title" fill="#ffffff" filter="url(#textGlow)">Index</text>

    <!-- "Matrix" in Vibrant Continuous Gradient -->
    <text x="590" y="818" class="brand-title" fill="url(#matrixTextGrad)">Matrix</text>

    <!-- Tagline: "SUBMIT • INDEX • GROW" -->
    <text x="627" y="908" class="brand-tagline" text-anchor="middle" fill="#cbd5e1">SUBMIT  •  INDEX  •  GROW</text>
  </g>
</svg>
`;
}

const svg = buildFullSvg();
fs.writeFileSync('/tmp/logo_v4.svg', svg);
fs.writeFileSync('/home/hj/Desktop/adii/logo.svg', svg);
console.log('Saved /tmp/logo_v4.svg and /home/hj/Desktop/adii/logo.svg');
