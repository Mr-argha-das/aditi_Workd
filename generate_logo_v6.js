const fs = require('fs');
const { execSync } = require('child_process');
const opentype = require('opentype.js');

// Load Outfit-900 (Black) for the brand name and Outfit-700 (Bold) for the tagline
const buf9 = fs.readFileSync('/tmp/Outfit-900.ttf');
const font9 = opentype.parse(buf9.buffer.slice(buf9.byteOffset, buf9.byteOffset + buf9.byteLength));

const buf7 = fs.readFileSync('/tmp/Outfit-700.ttf');
const font7 = opentype.parse(buf7.buffer.slice(buf7.byteOffset, buf7.byteOffset + buf7.byteLength));

// Function to generate paths with custom glyph handling
function getWordPaths(font, str, startX, baselineY, size, letterSpacing = 0) {
  let curX = startX;
  const scale = size / font.unitsPerEm;
  let paths = [];
  let dotInfo = null;

  for (let ch of str) {
    const g = font.charToGlyph(ch);
    
    // If character is 'i' in Matrix, separate stem from dot so we can render the dot with its radiant glow
    if (ch === 'i' && font === font9) {
      // Commands 0..5 are stem
      const stemPath = new opentype.Path();
      stemPath.commands = g.path.commands.slice(0, 6);
      const gStem = new opentype.Glyph({
        name: 'i_stem',
        unicode: 105,
        advanceWidth: g.advanceWidth,
        path: stemPath
      });
      paths.push(gStem.getPath(curX, baselineY, size).toPathData(2));
      
      // Calculate dot center
      // Dot center in font units is at x=144, y=640
      dotInfo = {
        cx: Math.round((curX + 144 * scale) * 10) / 10,
        cy: Math.round((baselineY - 640 * scale) * 10) / 10,
        r: Math.round((100 * scale) * 10) / 10
      };
    } else {
      const p = g.getPath(curX, baselineY, size);
      paths.push(p.toPathData(2));
    }
    curX += g.advanceWidth * scale + letterSpacing;
  }
  return { pathData: paths.join(' '), endX: curX, dotInfo };
}

// 1. Generate Typography Paths
// "Index" at size 145, baseline 822
const pIndex = getWordPaths(font9, 'Index', 182, 822, 145, 4.2);

// "Matrix" at size 145, baseline 822
const pMatrix = getWordPaths(font9, 'Matrix', 596, 822, 145, 1.8);

// Tagline: "SUBMIT • INDEX • GROW" at size 25.5, baseline 916 using Outfit-700
const pSubmit = getWordPaths(font7, 'SUBMIT', 283, 916, 25.5, 12.8);
const pIndexTag = getWordPaths(font7, 'INDEX', 570, 916, 25.5, 13.5);
const pGrow = getWordPaths(font7, 'GROW', 821, 916, 25.5, 12.8);

console.log('Dot on i info:', pMatrix.dotInfo);

function buildSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1254 1254" width="1254" height="1254" fill="none">
  <defs>
    <!-- Background Radial Ambient Atmosphere -->
    <radialGradient id="ambientGlow" cx="50%" cy="40%" r="48%">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.20"/>
      <stop offset="35%" stop-color="#4f46e5" stop-opacity="0.13"/>
      <stop offset="65%" stop-color="#9333ea" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Arrow Tip Specular Bloom -->
    <radialGradient id="arrowBloom" cx="866" cy="309" r="160" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.45"/>
      <stop offset="35%" stop-color="#818cf8" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>

    <!-- Glowing Dot on 'i' Radiant Gradient -->
    <radialGradient id="dotGlow" cx="42%" cy="38%" r="62%">
      <stop offset="0%" stop-color="#f5d0fe"/>
      <stop offset="30%" stop-color="#d946ef"/>
      <stop offset="70%" stop-color="#a855f7"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </radialGradient>

    <!-- High Quality Realistic 3D Soft Drop Shadows -->
    <filter id="ribbonShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="-6" dy="12" stdDeviation="14" flood-color="#010312" flood-opacity="0.9"/>
    </filter>

    <filter id="shaftShadow" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="-10" dy="12" stdDeviation="16" flood-color="#010210" flood-opacity="0.95"/>
    </filter>

    <filter id="pillarShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="-4" dy="-4" stdDeviation="10" flood-color="#000000" flood-opacity="0.8"/>
    </filter>

    <filter id="whiteGlow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="#ffffff" flood-opacity="0.25"/>
    </filter>

    <filter id="dotBloom" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#c084fc" flood-opacity="0.6"/>
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

    <!-- 4. Left Pillar Front Face Gradient (Luminous Cyan to Royal Blue) -->
    <linearGradient id="leftPillarFace" x1="0%" y1="100%" x2="40%" y2="0%">
      <stop offset="0%" stop-color="#67e8f9"/>
      <stop offset="25%" stop-color="#38bdf8"/>
      <stop offset="70%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>

    <!-- 5. Left Arch & Descending Ribbon Gradient -->
    <linearGradient id="leftRibbonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="30%" stop-color="#2563eb"/>
      <stop offset="70%" stop-color="#1d4ed8"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>

    <!-- 6. Ascending Arrow Shaft (Cyan to Royal Blue to Indigo to Violet) -->
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
      <stop offset="100%" stop-color="#e0f2fe"/>
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

    <!-- 10. Text "Matrix" Gradient (Continuous 6-Stop Linear Transition) -->
    <linearGradient id="matrixTextGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="20%" stop-color="#3b82f6"/>
      <stop offset="45%" stop-color="#6366f1"/>
      <stop offset="70%" stop-color="#a855f7"/>
      <stop offset="90%" stop-color="#c084fc"/>
      <stop offset="100%" stop-color="#d946ef"/>
    </linearGradient>
  </defs>

  <!-- Solid Deep Void Black Canvas -->
  <rect width="1254" height="1254" fill="#000000"/>

  <!-- Ambient Atmospheric Backdrops -->
  <circle cx="627" cy="480" r="460" fill="url(#ambientGlow)"/>
  <circle cx="866" cy="309" r="160" fill="url(#arrowBloom)"/>

  <!-- ==================== ICON MARK ==================== -->
  <g id="icon-mark">
    <!-- 1. Lower Left Growth Bar 1 (Shortest: width 40, height 73, top Y=588) -->
    <rect x="424" y="588" width="40" height="73" rx="18" fill="url(#bar1Grad)"/>

    <!-- 2. Lower Left Growth Bar 2 (Middle: width 40, height 105, top Y=556) -->
    <rect x="481" y="556" width="40" height="105" rx="18" fill="url(#bar2Grad)"/>

    <!-- 3. Lower Left Growth Bar 3 (Tallest: width 40, height 141, top Y=520) -->
    <rect x="538" y="520" width="40" height="141" rx="18" fill="url(#bar3Grad)"/>

    <!-- 4. Right Vertical Pillar with Futuristic Slanted Base -->
    <!-- Bounds: X=733 to 828. Left edge parallel gap (11px) to arrow shaft. -->
    <!-- Bottom base cuts diagonally from (755, 662) up to (815, 622) with rounded corners. -->
    <path d="M 782 480
             L 733 530
             L 733 635
             A 25 25 0 0 0 755 662
             L 815 622
             A 18 18 0 0 0 828 606
             L 828 450
             Z"
          fill="url(#rightColGrad)"
          filter="url(#pillarShadow)"/>

    <!-- 5. Left Arch & Descending Ribbon (Folds from top shoulder down to center valley) -->
    <!-- Curves over shoulder: (424, 380) -> (494, 347) -> (684, 474) -->
    <!-- Bottom edge slopes down: (514, 450) -> (529, 464) -> (666, 573) -->
    <path d="M 424 380
             C 424 356 455 347 494 347
             L 684 474
             L 666 573
             L 529 464
             L 514 450
             Z"
          fill="url(#leftRibbonGrad)"
          filter="url(#ribbonShadow)"/>

    <!-- 6. Left Pillar Front Face (Cyan to Royal Blue) -->
    <!-- Clean geometry: vertical left edge (424, 380) to (424, 566), -->
    <!-- Slanted bottom cut parallel to bars: (424, 566) to (514, 510), -->
    <!-- Vertical right inner edge: (514, 510) to (514, 450), -->
    <!-- Isometric fold crease: (514, 450) back to (424, 380). -->
    <path d="M 424 380
             L 424 566
             L 514 510
             L 514 450
             Z"
          fill="url(#leftPillarFace)"
          filter="url(#ribbonShadow)"/>

    <!-- 7. Isometric Crease Shadow Line -->
    <line x1="424" y1="380" x2="514" y2="450" stroke="#1e3a8a" stroke-width="2" opacity="0.6"/>

    <!-- 8. Ascending Arrow Shaft (Center valley up to arrow head notch) -->
    <!-- Rises at ~45° from (666, 573) to notch (806, 404), left edge (684, 474) to (746, 356) -->
    <path d="M 608 525
             C 615 565 640 573 666 573
             L 806 404
             L 746 356
             L 684 474
             Z"
          fill="url(#shaftGrad)"
          filter="url(#shaftShadow)"/>

    <!-- 9. Center Valley V-Turn Crease Highlight -->
    <path d="M 608 525
             C 615 562 638 573 666 573
             C 642 573 624 558 620 534
             Z"
          fill="#60a5fa"
          opacity="0.9"/>

    <!-- 10. Arrow Head (Specular 3D Diamond Chisel) -->
    <!-- Tip: (866, 309), Left barb: (746, 356), Right barb: (868, 438), Central Notch: (806, 404) -->
    <!-- Facet A: Upper Specular Half -->
    <path d="M 746 356
             L 866 309
             L 806 404
             Z"
          fill="url(#arrowLightFacet)"/>

    <!-- Facet B: Lower Violet Half -->
    <path d="M 866 309
             L 868 438
             L 806 404
             Z"
          fill="url(#arrowDarkFacet)"/>

    <!-- Central 3D Specular Ridge Highlight along arrow spine -->
    <line x1="806" y1="404" x2="866" y2="309" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" opacity="0.8"/>
  </g>

  <!-- ==================== TYPOGRAPHY ==================== -->
  <g id="typography">
    <!-- "Index" in Pure Solid White with subtle atmospheric bloom -->
    <path d="${pIndex.pathData}" fill="#ffffff" filter="url(#whiteGlow)"/>

    <!-- "Matrix" in Vibrant Continuous Gradient -->
    <path d="${pMatrix.pathData}" fill="url(#matrixTextGrad)"/>

    <!-- Glowing Radiant Violet Dot on the 'i' in Matrix -->
    <circle cx="${pMatrix.dotInfo.cx}" cy="${pMatrix.dotInfo.cy}" r="${pMatrix.dotInfo.r}" fill="url(#dotGlow)" filter="url(#dotBloom)"/>

    <!-- Tagline: "SUBMIT • INDEX • GROW" in Pure Crisp Vectors -->
    <g fill="#cbd5e1">
      <!-- "SUBMIT" -->
      <path d="${pSubmit.pathData}"/>
      <!-- Bullet 1 -->
      <circle cx="514" cy="906" r="4.5"/>
      <!-- "INDEX" -->
      <path d="${pIndexTag.pathData}"/>
      <!-- Bullet 2 -->
      <circle cx="765" cy="906" r="4.5"/>
      <!-- "GROW" -->
      <path d="${pGrow.pathData}"/>
    </g>
  </g>
</svg>
`;
}

const svg = buildSvg();
fs.writeFileSync('/home/hj/Desktop/adii/logo.svg', svg);
fs.writeFileSync('/tmp/logo_final.svg', svg);
execSync('magick /home/hj/Desktop/adii/logo.svg /tmp/logo_final.png');
console.log('Saved /home/hj/Desktop/adii/logo.svg and rendered /tmp/logo_final.png');
