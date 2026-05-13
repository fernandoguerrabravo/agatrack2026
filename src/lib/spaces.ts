import "server-only";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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
