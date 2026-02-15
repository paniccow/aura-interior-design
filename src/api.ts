import { authHeaders } from "./utils/auth";

const AI_API = "/api/ai";

export { AI_API };

interface AIMessage {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

/* Chat with AI — sends conversation history, returns text */
export async function aiChat(messages: AIMessage[]): Promise<string | null> {
  try {
    const headers = await authHeaders();
    const resp = await Promise.race([
      fetch(AI_API, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "chat", messages })
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 30000))
    ]);
    if (resp.ok) {
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.length > 5) { console.log("AI chat: OpenRouter success"); return text; }
    } else {
      const err = await resp.text();
      console.log("AI chat: OpenRouter " + resp.status, err.slice(0, 200));
    }
  } catch (err: unknown) { console.log("AI chat: OpenRouter error:", (err as Error)?.message); }
  return null;
}

/* Vision analysis — analyzes images with AI */
export async function analyzeImage(base64Data: string, mimeType: string, prompt: string): Promise<string | null> {
  const dataUrl = "data:" + mimeType + ";base64," + base64Data;
  try {
    const headers = await authHeaders();
    const resp = await Promise.race([
      fetch(AI_API, {
        method: "POST",
        headers,
        body: JSON.stringify({
          action: "chat",
          messages: [{ role: "user", content: [
            { type: "image_url", image_url: { url: dataUrl } },
            { type: "text", text: prompt }
          ]}],
          max_tokens: 2000
        })
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 45000))
    ]);
    if (resp.ok) {
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (text && text.length > 20) { console.log("Vision: OpenRouter success"); return text; }
    }
  } catch (err: unknown) { console.log("Vision: OpenRouter error:", (err as Error)?.message); }
  return null;
}

/* Image generation — generates interior design visualizations */
export async function generateAIImage(prompt: string, referenceImage?: string | null, productImageUrls?: string[], cadImage?: string | null): Promise<string | null> {
  try {
    const headers = await authHeaders();
    const resp = await Promise.race([
      fetch(AI_API, {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "image", prompt, referenceImage: referenceImage || null, cadImage: cadImage || null, productImageUrls: productImageUrls || [] })
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 120000))
    ]);

    if (resp.ok) {
      const data = await resp.json();
      const msg = data?.choices?.[0]?.message;

      // Format 1: images array
      if (msg?.images?.length > 0) {
        const imgData = msg.images[0];
        const src = typeof imgData === "string"
          ? (imgData.startsWith("data:") ? imgData : "data:image/png;base64," + imgData)
          : imgData?.image_url?.url || imgData?.url || imgData?.b64_json;
        if (src) { console.log("Image gen: success (images array)"); return src.startsWith("data:") ? src : "data:image/png;base64," + src; }
      }

      // Format 2: content as array with image blocks
      const content = msg?.content;
      if (Array.isArray(content)) {
        const imgBlock = content.find(b => b.type === "image_url" || b.type === "image");
        if (imgBlock) {
          const imgUrl = imgBlock.image_url?.url || imgBlock.url;
          if (imgUrl) { console.log("Image gen: success (content array)"); return imgUrl; }
        }
      }

      // Format 3: content as data URL string
      if (typeof content === "string" && content.startsWith("data:image")) {
        console.log("Image gen: success (data URL string)");
        return content;
      }

      console.log("Image gen: unexpected response format", JSON.stringify(data).slice(0, 200));
    } else if (resp.status === 402) {
      const errData = await resp.json().catch(() => ({}));
      console.log("Image gen: credits required \u2014", errData.message || "add credits at openrouter.ai");
      return "__CREDITS_REQUIRED__";
    } else {
      console.log("Image gen: error " + resp.status);
    }
  } catch (err: unknown) { console.log("Image gen: error:", (err as Error)?.message); }
  return null;
}
