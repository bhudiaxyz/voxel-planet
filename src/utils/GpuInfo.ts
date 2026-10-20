export function getGpuTier(): "high" | "medium" | "low" {
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl") ??
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return "medium";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (!ext) return "medium";
    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
    if (
      renderer.includes("Apple M") ||
      renderer.includes("RTX") ||
      renderer.includes("RX 6") ||
      renderer.includes("RX 7") ||
      renderer.includes("GTX 10") ||
      renderer.includes("GTX 16") ||
      renderer.includes("GTX 20") ||
      renderer.includes("GTX 30")
    )
      return "high";
    if (
      renderer.includes("Intel") ||
      renderer.includes("Mali") ||
      renderer.includes("Adreno")
    )
      return "low";
    return "medium";
  } catch {
    return "medium";
  }
}
