// Vercel Serverless Function — proxies AI requests to OpenRouter
// API key is stored as a Vercel environment variable (never exposed to client)

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Allowed origins — only your domain and localhost for dev
const ALLOWED_ORIGINS = [
  "https://aurainteriordesign.org",
  "https://www.aurainteriordesign.org",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173"
];

// In-memory rate limiter (per Vercel function instance)
// Resets when the serverless function cold-starts
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // max 30 requests per minute per IP

function getRateLimitKey(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.headers["x-real-ip"] || "unknown";
}

function checkRateLimit(key) {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(key, { windowStart: now, count: 1 });
    return true;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) return false;
  return true;
}

// Clean up stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW * 2) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

// Allowed models whitelist — prevent abuse via arbitrary model requests
const ALLOWED_MODELS = [
  "openai/gpt-4o-mini",
  "google/gemini-2.5-flash-image",
  "google/gemini-3-pro-image-preview"
];

// Increase max duration for image generation (Pro plan: up to 300s, Hobby: 60s)
export const maxDuration = 60;

export default async function handler(req, res) {
  // ─── ORIGIN VALIDATION ───
  const origin = req.headers.origin || req.headers.referer || "";
  const isAllowedOrigin = ALLOWED_ORIGINS.some(o => origin.startsWith(o));

  // Set CORS headers — only for allowed origins
  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    // In production, still allow the request but don't set CORS (browser will block cross-origin)
    // For server-to-server requests (no origin), we check other signals below
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  // Security headers on API responses
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ─── RATE LIMITING ───
  const clientKey = getRateLimitKey(req);
  if (!checkRateLimit(clientKey)) {
    console.warn("Rate limit exceeded for:", clientKey);
    return res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
  }

  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  // ─── REQUEST SIZE CHECK ───
  const contentLength = parseInt(req.headers["content-length"] || "0");
  if (contentLength > 5 * 1024 * 1024) { // 5MB max
    return res.status(413).json({ error: "Request too large" });
  }

  try {
    const { action, messages, model, prompt, referenceImage, cadImage, productImageUrls, max_tokens: clientMaxTokens } = req.body;

    // ─── INPUT VALIDATION ───
    if (!action || !["chat", "image"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    // Action: "image" — image generation (with optional reference room photo + CAD + product images)
    if (action === "image") {
      // Validate prompt length
      if (prompt && prompt.length > 10000) {
        return res.status(400).json({ error: "Prompt too long" });
      }

      // Validate product image URLs count
      if (productImageUrls && productImageUrls.length > 20) {
        return res.status(400).json({ error: "Too many product images" });
      }

      // Model priority: Gemini Flash (cheapest, good quality), then Gemini Pro fallback
      const imageModels = [
        model || "google/gemini-2.5-flash-image",
        "google/gemini-2.5-flash-image",
        "google/gemini-3-pro-image-preview"
      ];

      // Filter to allowed models only
      const uniqueModels = [...new Set(imageModels)].filter(m => ALLOWED_MODELS.includes(m));
      if (uniqueModels.length === 0) {
        return res.status(400).json({ error: "Invalid model requested" });
      }

      // Build multimodal message content
      let messageContent = [];

      const hasRoomPhoto = referenceImage && typeof referenceImage === "string" && referenceImage.startsWith("data:");
      const hasCadImage = cadImage && typeof cadImage === "string" && cadImage.startsWith("data:");

      // Add room photo as primary visual reference if available
      if (hasRoomPhoto) {
        messageContent.push({ type: "image_url", image_url: { url: referenceImage } });
      }

      // Add CAD/floor plan image as layout reference
      if (hasCadImage) {
        messageContent.push({ type: "image_url", image_url: { url: cadImage } });
      }

      // Add ALL product reference images (up to 17 — one per selected product)
      const imgUrls = (productImageUrls || []).filter(u => typeof u === "string" && (u.startsWith("https://") || u.startsWith("data:"))).slice(0, 17);
      if (imgUrls.length > 0) {
        for (const imgUrl of imgUrls) {
          messageContent.push({ type: "image_url", image_url: { url: imgUrl } });
        }
      }

      // Build concise text instruction labeling each image
      let textInstruction = "";
      if (hasRoomPhoto) {
        textInstruction += "First image: the user's actual room. Place furniture into this exact room.\n";
      }
      if (hasCadImage) {
        textInstruction += (hasRoomPhoto ? "Next" : "First") + " image: floor plan/CAD — use for furniture placement.\n";
      }
      if (imgUrls.length > 0) {
        textInstruction += "Product photos follow (one per item, in order) — match each product's look.\n\n";
      }
      textInstruction += (prompt || "Generate a photorealistic interior design photograph of a modern room.");

      messageContent.push({ type: "text", text: textInstruction });

      // If no images were added, use plain text content for compatibility
      if (messageContent.length === 1) {
        messageContent = textInstruction;
      }

      for (const imageModel of uniqueModels) {
        try {
          const startTime = Date.now();

          const response = await fetch(OPENROUTER_URL, {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + OPENROUTER_KEY,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://aurainteriordesign.org",
              "X-Title": "AURA Interior Design"
            },
            body: JSON.stringify({
              model: imageModel,
              messages: [{ role: "user", content: messageContent }],
              max_tokens: 8192
            })
          });

          const elapsed = Date.now() - startTime;

          if (!response.ok) {
            const errText = await response.text();
            console.error("OpenRouter image " + imageModel + ":", response.status, errText.slice(0, 300));
            if (response.status === 402) {
              return res.status(402).json({
                error: "credits_required",
                message: "Image generation requires purchased credits on OpenRouter.",
                details: errText.slice(0, 200)
              });
            }
            continue;
          }

          const data = await response.json();
          const msg = data?.choices?.[0]?.message;

          // Check for images in multiple possible formats
          if (msg?.images?.length > 0) {
            return res.status(200).json(data);
          }

          if (Array.isArray(msg?.content)) {
            const hasImage = msg.content.some(b => b.type === "image_url" || b.type === "image");
            if (hasImage) {
              return res.status(200).json(data);
            }
          }

          if (typeof msg?.content === "string" && msg.content.startsWith("data:image")) {
            return res.status(200).json(data);
          }
        } catch (err) {
          console.error("OpenRouter image " + imageModel + " error:", err.message);
        }
      }

      return res.status(500).json({ error: "All image models failed" });

    } else {
      // Chat or vision — standard chat completions
      // Validate messages
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: "Messages required" });
      }
      if (messages.length > 50) {
        return res.status(400).json({ error: "Too many messages" });
      }

      // Validate and clamp max_tokens
      const maxTokens = Math.min(Math.max(parseInt(clientMaxTokens) || 1000, 100), 4000);

      // Validate model
      const chatModel = ALLOWED_MODELS.includes(model) ? model : "openai/gpt-4o-mini";

      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + OPENROUTER_KEY,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://aurainteriordesign.org",
          "X-Title": "AURA Interior Design"
        },
        body: JSON.stringify({
          model: chatModel,
          messages: messages,
          temperature: 0.7,
          max_tokens: maxTokens
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("OpenRouter chat error:", response.status, errText.slice(0, 200));
        // Don't leak internal error details to client
        return res.status(response.status >= 500 ? 502 : response.status).json({ error: "Chat request failed" });
      }

      const data = await response.json();
      return res.status(200).json(data);
    }
  } catch (err) {
    console.error("AI proxy error:", err.message);
    return res.status(500).json({ error: "Internal server error" });
  }
}
