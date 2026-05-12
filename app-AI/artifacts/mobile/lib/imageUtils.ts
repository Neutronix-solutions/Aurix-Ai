/**
 * Receipt image utilities.
 *
 * expo-image-picker already applies quality compression (0.6) at capture time.
 * These utilities add an additional layer of safety:
 *  1. Validate that the base64 payload is within the 8 MB server limit.
 *  2. Provide a helper to estimate the encoded size before the upload.
 */

// 7 MB decoded → ~9.3 MB base64 string → safely under Express's 10 MB JSON limit.
export const MAX_IMAGE_BASE64_BYTES = 7 * 1024 * 1024; // 7 MB

/**
 * Returns the approximate byte-size of a base64 string.
 * base64 encoding inflates size by ~33 %; every 4 chars = 3 bytes.
 */
export function base64ByteSize(b64: string): number {
  // Strip data-URI prefix if present
  const data = b64.includes(",") ? b64.split(",")[1]! : b64;
  // Padding chars reduce byte count
  const padding = (data.match(/=+$/) ?? [])[0]?.length ?? 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/**
 * Returns a human-readable size string, e.g. "2.4 MB".
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validates a base64 image before upload.
 * Returns an error string if the image should be rejected, null if OK.
 */
export function validateReceiptImage(base64: string | null | undefined): string | null {
  if (!base64) return "No image data — please try capturing the receipt again.";
  const size = base64ByteSize(base64);
  if (size > MAX_IMAGE_BASE64_BYTES) {
    return (
      `The image is too large (${formatBytes(size)}). ` +
      `Maximum is ${formatBytes(MAX_IMAGE_BASE64_BYTES)}. ` +
      `Try cropping or reducing the image quality.`
    );
  }
  return null;
}
