const NOTION_VERSION = "2026-03-11";

// Notion's file_uploads create endpoint requires a filename with a valid
// extension OR a content_type it can map to an extension. Confluence sometimes
// hands us attachments with an extensionless title and/or a blank mediaType
// (e.g. pasted images, macro-generated resources), which trips the
// `validation_error: Provided filename is missing a valid extension or
// content_type` response. We bridge the gap by inferring whichever piece is
// missing from the other.
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/html": "html",
  "application/json": "json",
  "application/xml": "xml",
  "application/zip": "zip",
  "application/gzip": "gz",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

const EXT_TO_MIME: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [mime, ext] of Object.entries(MIME_TO_EXT)) {
    // First mime wins for a given extension (e.g. jpg -> image/jpeg).
    if (!out[ext]) out[ext] = mime;
  }
  out.jpeg = "image/jpeg";
  out.tif = "image/tiff";
  return out;
})();

export type NormalizedFileMeta = { filename: string; contentType: string };

/**
 * Ensure Notion always receives a filename with an extension and a matching
 * content type. Fills in whichever field is missing from the other; if neither
 * carries usable type information, falls back to a generic binary file so the
 * upload can still be attempted rather than rejected outright.
 */
export function normalizeFileMeta(
  filename: string | undefined,
  mimeType: string | undefined,
): NormalizedFileMeta {
  let name = (filename ?? "").trim() || "file";
  // Strip any charset/parameter suffix, e.g. "text/plain; charset=utf-8".
  let type = (mimeType ?? "").trim().split(";")[0].trim().toLowerCase();

  const extMatch = name.match(/\.([a-zA-Z0-9]{1,8})$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : "";

  if (!type && ext) {
    type = EXT_TO_MIME[ext] ?? "";
  }

  if (!ext) {
    const inferredExt = type ? MIME_TO_EXT[type] : "";
    if (inferredExt) {
      name = `${name}.${inferredExt}`;
    } else {
      // No extension and no recognizable type: attach a generic one so the
      // filename satisfies Notion's "must include an extension" rule.
      name = `${name}.bin`;
      if (!type) type = "application/octet-stream";
    }
  }

  return { filename: name, contentType: type };
}

export async function uploadFile(
  token: string,
  filename: string,
  contentType: string,
  bytes: Uint8Array,
): Promise<string> {
  const { filename: safeName, contentType: safeType } = normalizeFileMeta(
    filename,
    contentType,
  );

  const createBody: Record<string, unknown> = {
    mode: "single_part",
    filename: safeName,
  };
  // Only send content_type when we actually have one; an empty string is
  // rejected, and Notion can infer the type from the filename extension.
  if (safeType) createBody.content_type = safeType;

  const createRes = await fetch("https://api.notion.com/v1/file_uploads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    throw new Error(
      `Notion file_uploads create failed: ${createRes.status} ${await createRes.text()}`,
    );
  }
  const created = (await createRes.json()) as {
    id: string;
    upload_url: string;
  };

  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes as BlobPart], safeType ? { type: safeType } : {}),
    safeName,
  );
  const sendRes = await fetch(created.upload_url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
    },
    body: form,
  });
  if (!sendRes.ok) {
    throw new Error(
      `Notion file upload PUT failed: ${sendRes.status} ${await sendRes.text()}`,
    );
  }

  return created.id;
}
