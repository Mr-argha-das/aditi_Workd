/**
 * INDEX MATRIX - Hardware-Level Mobile Device Gatekeeper
 * 
 * Enforces Desktop Workstation Policy:
 * Mobile devices (phones and tablets) are strictly restricted to the /about.html overview.
 * Uses hardware touch digitizers, pointer coarseness, and physical screen dimensions
 * to detect mobile devices even when the user toggles "Request Desktop Site" in mobile browsers.
 */
(function() {
  function isMobileHardware() {
    var ua = navigator.userAgent || '';
    var mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(ua);
    
    // 1. Hardware multi-touch digitizer detection (phones/tablets have >= 5 touch points)
    var maxTouch = navigator.maxTouchPoints || 0;
    var hasMultiTouch = maxTouch > 1;
    
    // 2. Pointer capability media queries (coarse finger touch vs fine mouse pointer)
    var coarsePointer = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var noHover = window.matchMedia && window.matchMedia('(hover: none)').matches;
    
    // 3. Physical hardware display dimension (phones have narrow physical hardware width < 700px)
    var minDim = Math.min(window.screen.width, window.screen.height);
    var isSmallHardware = minDim < 700;

    // Detect mobile either via mobile User-Agent or via touchscreen hardware profile (anti-desktop-spoofing)
    return mobileUA || (hasMultiTouch && (coarsePointer || noHover || isSmallHardware));
  }

  if (isMobileHardware()) {
    var path = window.location.pathname || '';
    var isAllowedMobilePath = 
      path.endsWith('/device-restricted.html') || 
      path === '/device-restricted.html' || 
      path === '/device-restricted' ||
      path.endsWith('/about.html') || 
      path === '/about.html' || 
      path === '/about';

    if (!isAllowedMobilePath) {
      window.location.replace('/device-restricted.html');
    }
  }
})();

