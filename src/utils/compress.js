/* Compress/resize an image file to stay under Vercel's 4.5MB body limit.
   Returns { dataUrl, base64, mimeType } where base64 is under ~2MB */
export function compressImage(file, maxDim = 1200, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const ratio = Math.min(maxDim / w, maxDim / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        const base64 = dataUrl.split(",")[1];
        if (base64.length > 2500000) {
          const smallerUrl = canvas.toDataURL("image/jpeg", 0.4);
          resolve({ dataUrl: smallerUrl, base64: smallerUrl.split(",")[1], mimeType: "image/jpeg" });
        } else {
          resolve({ dataUrl, base64, mimeType: "image/jpeg" });
        }
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = ev.target.result;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}
