import "server-only";
import crypto from "crypto";

const KEY = process.env.CONSENT_ENCRYPTION_KEY || process.env.JWT_SECRET || "default-key-change-me";
const ALGO = "aes-256-gcm";

function deriveKey(): Buffer {
  return crypto.createHash("sha256").update(KEY).digest();
}

export function encrypt(text: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv) as crypto.CipherGCM;
  let enc = cipher.update(text, "utf8", "hex");
  enc += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${enc}`;
}

export function decrypt(encrypted: string): string {
  const key = deriveKey();
  const [ivHex, tagHex, enc] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv) as crypto.DecipherGCM;
  decipher.setAuthTag(tag);
  let dec = decipher.update(enc, "hex", "utf8");
  dec += decipher.final("utf8");
  return dec;
}

export function blindIndex(text: string): string {
  const hmacKey = crypto.createHash("sha256").update(KEY + "_blind").digest();
  return crypto.createHmac("sha256", hmacKey).update(text.toLowerCase().trim()).digest("hex");
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip + KEY).digest("hex").substring(0, 16);
}

export function generarFolio(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `CONS-${ts}-${rand}`;
}

export function generarFolioArsop(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `ARSOP-${ts}-${rand}`;
}
