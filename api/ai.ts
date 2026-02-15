// Vercel Serverless Function — proxies AI requests to OpenRouter
// API key is stored as a Vercel environment variable (never exposed to client)

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const OPENROUTER_KEY: string | undefined = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Supabase admin client for server-side auth verification
const supabaseAdmin = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

// Verify user JWT and fetch profile (plan, viz usage)
async function verifyUserAndPlan(req: VercelRequest): Promise<{
  user: { id: string; email?: string } | null;
  profile: Record<string, unknown> | null;
  error: string | null;
}> {
  if (!supabaseAdmin) return { user: null, profile: null, error: "Auth not configured" };
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return { user: null, profile: null, error: "No auth token" };

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return { user: null, profile: null, error: "Invalid token" };

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) return { user, profile: null, error: "Profile not found" };
  return { user, profile, error: null };
}

// Allowed origins — only your domain and localhost for dev
const ALLOWED_ORIGINS: string[] = [
  "https://aurainteriordesign.org",
  "https://www.aurainteriordesign.org",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:4173"
];

// In-memory rate limiter (per Vercel function instance)
// Resets when the serverless function cold-starts
const rateLimitMap = new Map<string, { windowStart: number; count: number }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // max 30 requests per minute per IP

function getRateLimitKey(req: VercelRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const forwardedStr = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return forwardedStr?.split(",")[0]?.trim() || (req.headers["x-real-ip"] as string) || "unknown";
}

function checkRateLimit(key: string): boolean {
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
const ALLOWED_MODELS: string[] = [
  "openai/gpt-4o-mini",
  "google/gemini-2.5-flash-image",
  "google/gemini-3-pro-image-preview"
];

// Increase max duration for image generation (Pro plan: up to 300s, Hobby: 60s)
export const maxDuration = 60;

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  // --- ORIGIN VALIDATION ---
  const origin = (req.headers.origin || req.headers.referer || "") as string;
  const isAllowedOrigin = ALLOWED_ORIGINS.some(o => origin.startsWith(o));

  // Set CORS headers — only for allowed origins
  if (isAllowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGINS[0]);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  // Security headers on API responses
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // --- RATE LIMITING ---
  const clientKey = getRateLimitKey(req);
  if (!checkRateLimit(clientKey)) {
    console.warn("Rate limit exceeded for:", clientKey);
    res.status(429).json({ error: "Too many requests. Please wait a moment and try again." });
    return;
  }

  if (!OPENROUTER_KEY) {
    res.status(500).json({ error: "API key not configured" });
    return;
  }

  // --- REQUEST SIZE CHECK ---
  const contentLength = parseInt((req.headers["content-length"] as string) || "0");
  if (contentLength > 5 * 1024 * 1024) { // 5MB max
    res.status(413).json({ error: "Request too large" });
    return;
  }

  try {
    const { action, messages, model, prompt, referenceImage, cadImage, productImageUrls, max_tokens: clientMaxTokens } = req.body as {
      action?: string;
      messages?: Array<{ role: string; content: unknown }>;
      model?: string;
      prompt?: string;
      referenceImage?: string;
      cadImage?: string;
      productImageUrls?: string[];
      max_tokens?: string | number;
    };

    // --- INPUT VALIDATION ---
    if (!action || !["chat", "image"].includes(action)) {
      res.status(400).json({ error: "Invalid action" });
      return;
    }

    // Action: "image" — image generation (with optional reference room photo + CAD + product images)
    if (action === "image") {
      // --- SERVER-SIDE VIZ LIMIT ENFORCEMENT ---
      const { user: authUser, profile, error: authError } = await verifyUserAndPlan(req);
      if (supabaseAdmin && (authError || !profile)) {
        res.status(401).json({ error: "Authentication required for image generation" });
        return;
      }

      if (profile) {
        const now = new Date();
        const currentMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
        const vizLimit = profile.plan === "pro" ? 100 : 1;
        const vizCount = (profile.viz_month === currentMonth) ? profile.viz_count as number : 0;

        if (vizCount >= vizLimit) {
          res.status(403).json({
            error: "viz_limit_reached",
            message: profile.plan === "pro"
              ? "You have used all 100 visualizations this month."
              : "Free plan allows 1 visualization per month. Upgrade to Pro for 100/month."
          });
          return;
        }
      }

      // Validate prompt length
      if (prompt && prompt.length > 10000) {
        res.status(400).json({ error: "Prompt too long" });
        return;
      }

      // Validate product image URLs count
      if (productImageUrls && productImageUrls.length > 20) {
        res.status(400).json({ error: "Too many product images" });
        return;
      }

      // Model priority: Gemini Flash (cheapest, good quality), then Gemini Pro fallback
      const imageModels: string[] = [
        model || "google/gemini-2.5-flash-image",
        "google/gemini-2.5-flash-image",
        "google/gemini-3-pro-image-preview"
      ];

      // Filter to allowed models only
      const uniqueModels = [...new Set(imageModels)].filter(m => ALLOWED_MODELS.includes(m));
      if (uniqueModels.length === 0) {
        res.status(400).json({ error: "Invalid model requested" });
        return;
      }

      // Build multimodal message content
      let messageContent: Array<{ type: string; text?: string; image_url?: { url: string } }> | string = [];

      const hasRoomPhoto = referenceImage && typeof referenceImage === "string" && referenceImage.startsWith("data:");
      const hasCadImage = cadImage && typeof cadImage === "string" && cadImage.startsWith("data:");

      // Add room photo as primary visual reference if available
      if (hasRoomPhoto) {
        (messageContent as Array<{ type: string; image_url?: { url: string } }>).push({ type: "image_url", image_url: { url: referenceImage } });
      }

      // Add CAD/floor plan image as layout reference
      if (hasCadImage) {
        (messageContent as Array<{ type: string; image_url?: { url: string } }>).push({ type: "image_url", image_url: { url: cadImage } });
      }

      // Add ALL product reference images (up to 17 — one per selected product)
      const imgUrls: string[] = (productImageUrls || []).filter((u: string) => typeof u === "string" && (u.startsWith("https://") || u.startsWith("data:"))).slice(0, 17);
      if (imgUrls.length > 0) {
        for (const imgUrl of imgUrls) {
          (messageContent as Array<{ type: string; image_url?: { url: string } }>).push({ type: "image_url", image_url: { url: imgUrl } });
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

      (messageContent as Array<{ type: string; text?: string }>).push({ type: "text", text: textInstruction });

      // If no images were added, use plain text content for compatibility
      if ((messageContent as Array<unknown>).length === 1) {
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
              res.status(402).json({
                error: "credits_required",
                message: "Image generation requires purchased credits on OpenRouter.",
                details: errText.slice(0, 200)
              });
              return;
            }
            continue;
          }

          const data = await response.json();
          const msg = data?.choices?.[0]?.message as Record<string, unknown> | undefined;

          // Check for images in multiple possible formats
          const hasGeneratedImage = (
            (Array.isArray(msg?.images) && (msg!.images as unknown[]).length > 0) ||
            (Array.isArray(msg?.content) && (msg!.content as Array<{ type: string }>).some((b: { type: string }) => b.type === "image_url" || b.type === "image")) ||
            (typeof msg?.content === "string" && (msg!.content as string).startsWith("data:image"))
          );

          if (hasGeneratedImage) {
            // Increment viz count in Supabase (server-side tracking)
            if (supabaseAdmin && authUser && profile) {
              const now = new Date();
              const currentMonth = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
              const vizCount = (profile.viz_month === currentMonth) ? profile.viz_count as number : 0;
              await supabaseAdmin.from("profiles").update({
                viz_count: vizCount + 1,
                viz_month: currentMonth
              }).eq("id", authUser.id);
            }
            res.status(200).json(data);
            return;
          }
        } catch (err: unknown) {
          console.error("OpenRouter image " + imageModel + " error:", (err as Error).message);
        }
      }

      res.status(500).json({ error: "All image models failed" });
      return;

    } else {
      // Chat or vision — standard chat completions
      // Validate messages
      if (!Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "Messages required" });
        return;
      }
      if (messages.length > 50) {
        res.status(400).json({ error: "Too many messages" });
        return;
      }

      // Validate and clamp max_tokens
      const maxTokens = Math.min(Math.max(parseInt(clientMaxTokens as string) || 1000, 100), 4000);

      // Validate model
      const chatModel = ALLOWED_MODELS.includes(model || "") ? model! : "openai/gpt-4o-mini";

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
        res.status(response.status >= 500 ? 502 : response.status).json({ error: "Chat request failed" });
        return;
      }

      const data = await response.json();
      res.status(200).json(data);
      return;
    }
  } catch (err: unknown) {
    console.error("AI proxy error:", (err as Error).message);
    res.status(500).json({ error: "Internal server error" });
    return;
  }
}
