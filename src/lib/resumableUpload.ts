import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

/**
 * Resumable upload to a Supabase Storage bucket using the TUS protocol.
 * Supports files much larger than the standard 50 MiB single-request limit.
 */
export async function uploadFileResumable(opts: {
  bucket: string;
  path: string;
  file: File;
  onProgress?: (percent: number, uploadedBytes: number, totalBytes: number) => void;
  upsert?: boolean;
}): Promise<{ path: string }> {
  const { bucket, path, file, onProgress, upsert = true } = opts;

  const { data: sessionData } = await supabase.auth.getSession();
  const token =
    sessionData?.session?.access_token ??
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string);

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${token}`,
        "x-upsert": upsert ? "true" : "false",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      chunkSize: 6 * 1024 * 1024, // 6 MB chunks (Supabase requirement)
      onError: (err) => reject(err),
      onProgress: (bytesSent, bytesTotal) => {
        const pct = bytesTotal > 0 ? (bytesSent / bytesTotal) * 100 : 0;
        onProgress?.(pct, bytesSent, bytesTotal);
      },
      onSuccess: () => resolve({ path }),
    });

    // Resume if a previous upload of the same file is found
    upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) {
        upload.resumeFromPreviousUpload(previous[0]);
      }
      upload.start();
    });
  });
}
