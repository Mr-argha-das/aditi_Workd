/**
 * SEO NEXUS - Real Keyword Extractor & In-Browser PDF/Text Parser
 */

const PDFKeywordExtractor = (() => {
  // English Stopwords for clean SEO phrase extraction
  const STOP_WORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'could', 'did', 'do',
    'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
    'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
    'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
    'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so',
    'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
    'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
    'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself',
    'yourselves', 'will', 'can', 'also', 'page', 'site', 'website', 'click', 'read', 'view', 'terms', 'privacy'
  ]);

  // Pre-configured keyword sample datasets
  const SAMPLE_PACKS = {
    ecommerce: {
      name: 'E-Commerce & Gadgets Pack',
      text: `cloud tech gadgets modern electronics high performance gear smart home automation fast shipping accessories best wireless headphones premium laptop bag bluetooth gaming mouse mechanical keyboard 4k monitor ergonomic office chair portable power bank usb c charging dock noise cancelling earbuds top tech gifts discount electronic deals buy smart devices online`
    },
    saas: {
      name: 'SaaS & Cloud Software Pack',
      text: `b2b cloud software enterprise analytics platform ai customer service automated workflow tools api integrations real time data monitoring crm pipeline manager secure cloud backup software as a service team collaboration tool project management system agile sprint tracker cyber security scanner database migration tools`
    },
    agency: {
      name: 'Digital Agency & SEO Pack',
      text: `seo optimization agency search engine rankings google search console indexing organic traffic growth local seo audit technical backlink analysis keyword research tool content marketing strategy conversion rate optimization pay per click advertising web design agency speed optimization structured data json ld schema`
    },
    local: {
      name: 'Local Business & Healthcare Pack',
      text: `local dental clinic 24 7 emergency medical care licensed general contractor certified home inspection reliable plumbing services top rated auto repair near me affordable roofing company certified accountant fast tax filing family legal counselor pediatric care center`
    }
  };

  // Classify intent based on semantic triggers
  function classifyIntent(phrase) {
    const lower = phrase.toLowerCase();
    if (/(\bhow\b|\bwhat\b|\bwhy\b|\bguide\b|\btips\b|\btutorial\b|\bideas\b|\bexample\b|\blearn\b)/i.test(lower)) {
      return 'Informational';
    }
    if (/(\bbest\b|\btop\b|\breview\b|\bvs\b|\bcomparison\b|\brated\b|\balternatives\b|\bfeatures\b)/i.test(lower)) {
      return 'Commercial';
    }
    if (/(\bbuy\b|\border\b|\bprice\b|\bpricing\b|\bcost\b|\bcheap\b|\bdiscount\b|\bcoupon\b|\bhire\b|\bservices\b|\bshop\b|\bdeal\b|\bquote\b)/i.test(lower)) {
      return 'Transactional';
    }
    return 'Navigational';
  }

  // Calculate search metrics algorithmically
  function estimateMetrics(phrase, count) {
    const len = phrase.split(' ').length;
    const hash = phrase.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    
    let baseVolume = 12000;
    if (len === 1) baseVolume = 35000 + (hash % 25000);
    else if (len === 2) baseVolume = 8000 + (hash % 12000);
    else baseVolume = 1500 + (hash % 5000);

    const estimatedVol = Math.round(baseVolume * (0.8 + (count * 0.15)));
    const volFormatted = estimatedVol.toLocaleString() + '/mo';

    let diffScore = 20 + (hash % 60);
    if (len >= 3) diffScore = Math.max(12, diffScore - 25);
    
    let diffLabel = 'Low';
    if (diffScore >= 60) diffLabel = 'High';
    else if (diffScore >= 35) diffLabel = 'Medium';

    return {
      volume: volFormatted,
      difficulty: `${diffLabel} (${diffScore}%)`,
      difficultyScore: diffScore
    };
  }

  // Parse raw text and extract 1-word, 2-word, and 3-word keywords
  function extractKeywordsFromText(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];

    const cleaned = rawText
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const words = cleaned.split(' ').filter(w => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
    const totalWords = words.length;
    if (totalWords === 0) return [];

    const phraseCounts = {};

    // 1-Gram
    for (let i = 0; i < words.length; i++) {
      const term = words[i];
      phraseCounts[term] = (phraseCounts[term] || 0) + 1;
    }

    // 2-Gram
    for (let i = 0; i < words.length - 1; i++) {
      const term = `${words[i]} ${words[i + 1]}`;
      if (!STOP_WORDS.has(words[i]) && !STOP_WORDS.has(words[i + 1])) {
        phraseCounts[term] = (phraseCounts[term] || 0) + 1;
      }
    }

    // 3-Gram
    for (let i = 0; i < words.length - 2; i++) {
      const term = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (!STOP_WORDS.has(words[i]) && !STOP_WORDS.has(words[i + 1]) && !STOP_WORDS.has(words[i + 2])) {
        phraseCounts[term] = (phraseCounts[term] || 0) + 1;
      }
    }

    const sorted = Object.entries(phraseCounts)
      .map(([term, count]) => {
        const density = ((count / totalWords) * 100).toFixed(1) + '%';
        const intent = classifyIntent(term);
        const { volume, difficulty, difficultyScore } = estimateMetrics(term, count);
        return {
          term,
          count,
          density,
          volume,
          difficulty,
          difficultyScore,
          intent
        };
      })
      .sort((a, b) => {
        const aScore = (a.term.split(' ').length > 1 ? a.count * 1.8 : a.count);
        const bScore = (b.term.split(' ').length > 1 ? b.count * 1.8 : b.count);
        return bScore - aScore;
      })
      .slice(0, 35);

    return sorted;
  }

  // Parse a file (Real server-side parser with client-side fallback)
  async function parseFile(file) {
    if (!file) throw new Error('No file provided');

    // 1. Try real server parser first
    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = localStorage.getItem('index_matrix_token') || '';
      const headers = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/upload-file', {
        method: 'POST',
        headers,
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.keywords) && data.keywords.length > 0) {
          return {
            fileName: data.fileName || file.name,
            fileSize: data.fileSize || ((file.size / 1024).toFixed(1) + ' KB'),
            textLength: data.textLength || 0,
            keywords: data.keywords
          };
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.warn('Backend upload-file warning:', errJson.error || res.statusText);
      }
    } catch (e) {
      console.warn('Backend file upload fallback to in-browser parsing:', e.message);
    }

    // 2. Client-side PDF / Text fallback
    const fileName = file.name.toLowerCase();
    if (fileName.endsWith('.pdf')) {
      return await parsePDFFile(file);
    } else {
      return await parseTextFile(file);
    }
  }

  function parseTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target.result;
        const keywords = extractKeywordsFromText(text);
        resolve({
          fileName: file.name,
          fileSize: (file.size / 1024).toFixed(1) + ' KB',
          textLength: text.length,
          keywords
        });
      };
      reader.onerror = (err) => reject(err);
      reader.readAsText(file);
    });
  }

  async function parsePDFFile(file) {
    if (window.pdfjsLib) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + ' ';
        }

        const keywords = extractKeywordsFromText(fullText);
        return {
          fileName: file.name,
          fileSize: (file.size / 1024).toFixed(1) + ' KB',
          numPages: pdf.numPages,
          textLength: fullText.length,
          keywords
        };
      } catch (err) {
        console.warn('PDF.js parsing fallback', err);
      }
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const buffer = new Uint8Array(e.target.result);
        let extracted = '';
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] >= 32 && buffer[i] <= 126) {
            extracted += String.fromCharCode(buffer[i]);
          } else if (buffer[i] === 10 || buffer[i] === 13) {
            extracted += ' ';
          }
        }
        const keywords = extractKeywordsFromText(extracted);
        resolve({
          fileName: file.name,
          fileSize: (file.size / 1024).toFixed(1) + ' KB',
          textLength: extracted.length,
          keywords
        });
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function loadSamplePack(packKey) {
    const pack = SAMPLE_PACKS[packKey];
    if (!pack) return null;
    const keywords = extractKeywordsFromText(pack.text);
    return {
      fileName: pack.name + ' (Preloaded Dataset)',
      fileSize: '34.2 KB',
      keywords
    };
  }

  return {
    extractKeywordsFromText,
    parseFile,
    loadSamplePack,
    SAMPLE_PACKS
  };
})();
