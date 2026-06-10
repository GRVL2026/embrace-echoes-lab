import { WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions";
import { draco, dedup, prune } from "@gltf-transform/functions";
import draco3d from "draco3dgltf";

/**
 * Compress a .glb/.gltf File using Draco mesh compression.
 * Returns a new File (.glb) significantly smaller than the input.
 * Falls back to the original file on any error.
 */
export async function compressGLB(
  file: File,
  onProgress?: (msg: string) => void
): Promise<File> {
  try {
    onProgress?.("Lecture du modèle…");
    const buffer = new Uint8Array(await file.arrayBuffer());

    const io = new WebIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({
        "draco3d.decoder": await draco3d.createDecoderModule(),
        "draco3d.encoder": await draco3d.createEncoderModule(),
      });

    onProgress?.("Analyse de la géométrie…");
    const document = await io.readBinary(buffer);

    onProgress?.("Compression Draco en cours…");
    await document.transform(
      dedup(),
      prune(),
      draco({ method: "edgebreaker", encodeSpeed: 5, decodeSpeed: 5 })
    );

    const out = await io.writeBinary(document);
    const compressed = new File(
      [out],
      file.name.replace(/\.(glb|gltf)$/i, ".glb"),
      { type: "model/gltf-binary" }
    );

    // Only keep the compressed version if it's actually smaller
    if (compressed.size < file.size * 0.95) {
      return compressed;
    }
    return file;
  } catch (e) {
    console.warn("[compressGLB] échec compression, fichier original conservé:", e);
    return file;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
