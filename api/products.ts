// Vercel Serverless Function — proxies product search requests to RapidAPI Real-Time Product Search
// RapidAPI key is stored as a Vercel environment variable (never exposed to client)

import type { VercelRequest, VercelResponse } from "@vercel/node";

const RAPIDAPI_KEY: string | undefined = process.env.RAPIDAPI_KEY;
const RAPIDAPI_HOST = "real-time-product-search.p.rapidapi.com";

// ─── Simple in-memory cache (10 min TTL) ───
interface CacheEntry {
  data: unknown;
  expires: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(key: string): unknown | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expires) return entry.data;
  if (entry) cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  // Keep cache small — evict old entries
  if (cache.size > 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now >= v.expires) cache.delete(k);
    }
  }
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
}

// ─── Category → search query mapping ───
const CATEGORY_QUERIES: Record<string, string> = {
  all: "home furniture decor",
  sofa: "modern sofa couch",
  table: "dining table coffee table",
  chair: "accent chair dining chair",
  bed: "bed frame headboard",
  light: "modern lighting chandelier lamp",
  rug: "area rug runner",
  storage: "bookshelf cabinet sideboard dresser",
  outdoor: "outdoor patio furniture",
  stool: "bar stool counter stool",
  art: "wall art canvas print",
  accent: "home decor accessories vase",
};

// ─── Infer furniture category from product title ───
function inferCategory(title: string): string {
  const t = title.toLowerCase();
  if (/\bsofa\b|couch|sectional|loveseat|settee/.test(t)) return "sofa";
  if (/\bbed\b|headboard|bed\s*frame|mattress/.test(t)) return "bed";
  if (/\btable\b|desk|coffee\s*table|dining\s*table|end\s*table|console/.test(t)) return "table";
  if (/\bchair\b|recliner|armchair|accent\s*chair/.test(t)) return "chair";
  if (/\bstool\b|bar\s*stool|counter/.test(t)) return "stool";
  if (/\blamp\b|light|chandelier|pendant|sconce/.test(t)) return "light";
  if (/\brug\b|carpet|runner/.test(t)) return "rug";
  if (/\bart\b|canvas|print|painting|poster|mirror/.test(t)) return "art";
  if (/\bshelf\b|bookcase|cabinet|dresser|sideboard|storage|wardrobe/.test(t)) return "storage";
  if (/\bvase\b|pillow|throw|blanket|candle|basket|planter|decor/.test(t)) return "accent";
  if (/\boutdoor\b|patio/.test(t)) return "accent";
  return "accent";
}

// ─── Parse price from string like "$123.45" or "$1,234" ───
function parsePrice(priceStr: string | undefined | null): number {
  if (!priceStr) return 0;
  const cleaned = String(priceStr).replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
}

// ─── Map RapidAPI response to our Product shape ───
interface RapidAPIProduct {
  product_id?: string;
  product_title?: string;
  product_description?: string;
  product_photos?: string[];
  product_page_url?: string;
  product_rating?: number;
  product_num_reviews?: number;
  typical_price_range?: string[];
  offer?: {
    store_name?: string;
    price?: string;
    shipping?: string;
    on_sale?: boolean;
    product_condition?: string;
  };
  product_attributes?: Record<string, string>;
}

interface MappedProduct {
  id: number;
  n: string;
  r: string;
  p: number;
  l: string;
  u: string;
  c: string;
  v: string[];
  rm: string[];
  kaa: number;
  pr: string;
  img: string;
}

let idCounter = -1;

function mapProduct(raw: RapidAPIProduct): MappedProduct | null {
  const title = raw.product_title || "";
  if (!title) return null;

  // Get image — skip products without images
  const img = (raw.product_photos && raw.product_photos.length > 0) ? raw.product_photos[0] : "";
  if (!img) return null;

  // Get price
  let price = 0;
  if (raw.offer?.price) {
    price = parsePrice(raw.offer.price);
  } else if (raw.typical_price_range && raw.typical_price_range.length > 0) {
    price = parsePrice(raw.typical_price_range[0]);
  }
  if (price <= 0) return null; // Skip products with no price

  // Get retailer
  const retailer = raw.offer?.store_name || raw.product_attributes?.["Store"] || "Online Store";

  // Get URL
  const url = raw.product_page_url || "";
  if (!url) return null;

  const id = idCounter--;

  return {
    id,
    n: title.length > 80 ? title.slice(0, 77) + "..." : title,
    r: retailer,
    p: price,
    l: "Ships fast",
    u: url,
    c: inferCategory(title),
    v: [],
    rm: [],
    kaa: 0,
    pr: (title + " " + retailer).toLowerCase(),
    img,
  };
}

// ─── Main handler ───
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  if (!RAPIDAPI_KEY) {
    res.status(500).json({ error: "RAPIDAPI_KEY not configured" });
    return;
  }

  const { query, page = 1, category } = req.body || {};

  // Build search query
  let searchQuery: string;
  if (query && query.trim()) {
    searchQuery = query.trim();
  } else if (category && CATEGORY_QUERIES[category]) {
    searchQuery = CATEGORY_QUERIES[category];
  } else {
    searchQuery = "home furniture decor";
  }

  // Check cache
  const cacheKey = `${searchQuery}:${page}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  try {
    const apiUrl = `https://${RAPIDAPI_HOST}/search?q=${encodeURIComponent(searchQuery)}&country=us&language=en&page=${page}&limit=40&sort_by=BEST_MATCH&product_condition=ANY&min_rating=ANY`;

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "x-rapidapi-key": RAPIDAPI_KEY,
        "x-rapidapi-host": RAPIDAPI_HOST,
      },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("RapidAPI error:", response.status, errText.slice(0, 200));
      res.status(response.status).json({ error: "Product search failed", products: [], total: 0 });
      return;
    }

    const data = await response.json();
    const rawProducts: RapidAPIProduct[] = data?.data || data?.products || [];

    // Reset ID counter for each fresh search to keep IDs predictable
    // (page 1 = -1 to -40, page 2 = -41 to -80, etc.)
    idCounter = -(((page - 1) * 40) + 1);

    const products: MappedProduct[] = [];
    for (const raw of rawProducts) {
      const mapped = mapProduct(raw);
      if (mapped) products.push(mapped);
    }

    // Extract unique retailers for display
    const retailers = [...new Set(products.map(p => p.r))];

    const result = {
      products,
      total: data?.total_count || data?.total || products.length * 5,
      retailers,
      query: searchQuery,
      page,
    };

    setCache(cacheKey, result);
    res.status(200).json(result);
  } catch (err: unknown) {
    console.error("Product search error:", (err as Error)?.message);
    res.status(500).json({ error: "Internal server error", products: [], total: 0 });
  }
}
