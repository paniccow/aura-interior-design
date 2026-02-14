// Vercel Serverless Function — proxies AI requests to OpenRouter
// API key is stored as a Vercel environment variable (never exposed to client)

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Increase max duration for image generation (Pro plan: up to 300s, Hobby: 60s)
export const maxDuration = 60;

export default async function handler(req, res) {
  // CORS headers for the frontend
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!OPENROUTER_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  try {
    const { action, messages, model, prompt, referenceImage, cadImage, productImageUrls, max_tokens: clientMaxTokens } = req.body;

    // Action: "image" — image generation (with optional reference room photo + CAD + product images)
    if (action === "image") {
      // Model priority: Gemini Flash (cheapest, good quality), then Gemini Pro fallback
      const imageModels = [
        model || "google/gemini-2.5-flash-image",
        "google/gemini-2.5-flash-image",
        "google/gemini-3-pro-image-preview"
      ];

      // Deduplicate models list
      const uniqueModels = [...new Set(imageModels)];

      // Build multimodal message content
      // Priority: 1) Room photo reference, 2) CAD/floor plan, 3) Product reference images, 4) Text prompt
      let messageContent = [];

      const hasRoomPhoto = referenceImage && referenceImage.startsWith("data:");
      const hasCadImage = cadImage && cadImage.startsWith("data:");

      // Add room photo as primary visual reference if available
      if (hasRoomPhoto) {
        messageContent.push({ type: "image_url", image_url: { url: referenceImage } });
        console.log("Image gen: including room photo reference");
      }

      // Add CAD/floor plan image as layout reference
      if (hasCadImage) {
        messageContent.push({ type: "image_url", image_url: { url: cadImage } });
        console.log("Image gen: including CAD/floor plan image");
      }

      // Add ALL product reference images (up to 17 — one per selected product)
      const imgUrls = (productImageUrls || []).filter(Boolean).slice(0, 17);
      if (imgUrls.length > 0) {
        for (const imgUrl of imgUrls) {
          messageContent.push({ type: "image_url", image_url: { url: imgUrl } });
        }
        console.log("Image gen: including " + imgUrls.length + " product reference images");
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
          console.log("Trying image model:", imageModel);
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
              max_tokens: 4096
            })
          });

          const elapsed = Date.now() - startTime;
          console.log("Model " + imageModel + " responded in " + elapsed + "ms, status: " + response.status);

          if (!response.ok) {
            const errText = await response.text();
            console.error("OpenRouter image " + imageModel + ":", response.status, errText.slice(0, 300));
            // If it's a 402 credits issue, return immediately with a helpful message
            if (response.status === 402) {
              return res.status(402).json({
                error: "credits_required",
                message: "Image generation requires purchased credits on OpenRouter. Your free tier balance cannot be used for image models. Please add credits at openrouter.ai/settings/credits — even $1 will generate many images.",
                details: errText.slice(0, 200)
              });
            }
            continue;
          }

          const data = await response.json();
          const msg = data?.choices?.[0]?.message;

          // Log what we got back for debugging
          console.log("Model " + imageModel + " response keys:", msg ? Object.keys(msg).join(",") : "no message");

          // Check for images in multiple possible formats
          if (msg?.images?.length > 0) {
            console.log("SUCCESS: " + imageModel + " returned " + msg.images.length + " image(s) in " + elapsed + "ms");
            return res.status(200).json(data);
          }

          if (Array.isArray(msg?.content)) {
            const hasImage = msg.content.some(b => b.type === "image_url" || b.type === "image");
            if (hasImage) {
              console.log("SUCCESS: " + imageModel + " returned image in content array in " + elapsed + "ms");
              return res.status(200).json(data);
            }
          }

          if (typeof msg?.content === "string" && msg.content.startsWith("data:image")) {
            console.log("SUCCESS: " + imageModel + " returned data URL in content in " + elapsed + "ms");
            return res.status(200).json(data);
          }

          console.log("OpenRouter image " + imageModel + ": no image in response, content type: " + typeof msg?.content);
        } catch (err) {
          console.error("OpenRouter image " + imageModel + " error:", err.message);
        }
      }

      return res.status(500).json({ error: "All image models failed. This may be a credits issue — check openrouter.ai/settings/credits" });

    } else {
      // Chat or vision — standard chat completions
      const chatModel = model || "openai/gpt-4o-mini";
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
          messages: messages || [],
          temperature: 0.7,
          max_tokens: clientMaxTokens || 1000
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("OpenRouter chat error:", response.status, errText);
        return res.status(response.status).json({ error: "Chat failed", details: errText });
      }

      const data = await response.json();
      return res.status(200).json(data);
    }
  } catch (err) {
    console.error("AI proxy error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
