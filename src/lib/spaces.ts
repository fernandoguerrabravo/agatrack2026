import "server-only";
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

const client = new S3Client({
  endpoint: process.env.DO_SPACES_ENDPOINT ?? "https://sfo3.digitaloceanspaces.com",
  region: process.env.DO_SPACES_REGION ?? "sfo3",
  credentials: {
    accessKeyId: process.env.DO_SPACES_KEY ?? "",
    secretAccessKey: process.env.DO_SPACES_SECRET ?? "",
  },
  forcePathStyle: false,
});

const BUCKET = process.env.DO_SPACES_BUCKET ?? "agatrack";

/**
 * Sube un archivo a DigitalOcean Spaces y retorna la URL pública.
 */
export async function uploadToSpaces(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: "public-read",
    })
  );

  return `https://${BUCKET}.${process.env.DO_SPACES_REGION ?? "sfo3"}.digitaloceanspaces.com/${key}`;
}


/**
 * Elimina un archivo de DigitalOcean Spaces por su URL.
 */
export async function deleteFromSpaces(url: string): Promise<void> {
  if (!url) return;
  // Extraer el key de la URL
  const bucket = process.env.DO_SPACES_BUCKET ?? "agatrack";
  const region = process.env.DO_SPACES_REGION ?? "sfo3";
  const prefix = `https://${bucket}.${region}.digitaloceanspaces.com/`;
  const key = url.startsWith(prefix) ? url.slice(prefix.length) : url;

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

/**
 * Elimina todos los archivos de una carpeta (prefix) en Spaces.
 */
export async function deleteFolderFromSpaces(prefix: string): Promise<void> {
  const bucket = process.env.DO_SPACES_BUCKET ?? "agatrack";

  const listResult = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    })
  );

  if (listResult.Contents && listResult.Contents.length > 0) {
    for (const obj of listResult.Contents) {
      if (obj.Key) {
        await client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: obj.Key,
          })
        );
      }
    }
  }
}
