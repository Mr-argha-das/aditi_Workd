/**
 * SEO NEXUS - Universal 1-Line Dynamic SEO Injector Pixel
 * 
 * Embed this single script into your website once:
 * <script src="http://localhost:8080/seo-nexus-pixel.js" data-site="https://yourwebsite.com"></script>
 * 
 * It automatically fetches your latest Schema.org JSON-LD and Meta Tags
 * from SEO Nexus and injects them directly into the <head> dynamically!
 */
(function () {
  try {
    const currentScript = document.currentScript || document.querySelector('script[src*="seo-nexus-pixel.js"]');
    const serverOrigin = currentScript && currentScript.src ? new URL(currentScript.src).origin : 'http://localhost:8080';
    const siteUrl = currentScript && currentScript.getAttribute('data-site') 
      ? currentScript.getAttribute('data-site') 
      : window.location.origin;

    fetch(`${serverOrigin}/api/pixel/config?url=${encodeURIComponent(siteUrl)}`)
      .then(res => res.json())
      .then(data => {
        if (!data || !data.success) return;

        // 1. Inject or update Meta Title if empty
        if (data.metaTitle && (!document.title || document.title.length < 5)) {
          document.title = data.metaTitle;
        }

        // 2. Inject or update Meta Description
        if (data.metaDescription) {
          let desc = document.querySelector('meta[name="description"]');
          if (!desc) {
            desc = document.createElement('meta');
            desc.name = 'description';
            document.head.appendChild(desc);
          }
          desc.content = data.metaDescription;
        }

        // 3. Inject Keywords Tag
        if (data.keywordsStr) {
          let kw = document.querySelector('meta[name="keywords"]');
          if (!kw) {
            kw = document.createElement('meta');
            kw.name = 'keywords';
            document.head.appendChild(kw);
          }
          kw.content = data.keywordsStr;
        }

        // 4. Inject Googlebot & Robots Directives
        let robots = document.querySelector('meta[name="robots"]');
        if (!robots) {
          robots = document.createElement('meta');
          robots.name = 'robots';
          robots.content = 'index, follow, max-image-preview:large';
          document.head.appendChild(robots);
        }

        // 5. Inject Schema.org JSON-LD Structured Data
        if (data.schemaObj) {
          const existingSchema = document.getElementById('seonexus-injected-schema');
          if (existingSchema) existingSchema.remove();

          const script = document.createElement('script');
          script.id = 'seonexus-injected-schema';
          script.type = 'application/ld+json';
          script.text = JSON.stringify(data.schemaObj, null, 2);
          document.head.appendChild(script);
        }

        console.log(`%c⚡ [INDEX MATRIX Pixel] Injected live Schema JSON-LD & Meta Tags for ${data.url}`, 'color: #38bdf8; font-weight: bold;');
      })
      .catch(err => {
        console.warn('[INDEX MATRIX Pixel] Could not sync with SEO server:', err);
      });
  } catch (e) {
    console.error('[INDEX MATRIX Pixel] Initialization error:', e);
  }
})();
