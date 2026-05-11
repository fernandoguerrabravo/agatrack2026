import "server-only";

const AIRTABLE_API_KEY = () => process.env.AIRTABLE_API_KEY!;
const AIRTABLE_BASE_ID = () => process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_TABLE = () =>
  process.env.AIRTABLE_TABLE_ID ?? process.env.AIRTABLE_TABLE_NAME ?? "usuarios";

function baseUrl() {
  return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID()}/${encodeURIComponent(AIRTABLE_TABLE())}`;
}

function headers() {
  return {
    Authorization: `Bearer ${AIRTABLE_API_KEY()}`,
    "Content-Type": "application/json",
  };
}

export type AirtableUser = {
  id: string;
  rut: string;
  passwordHash: string;
  nombre?: string;
  email?: string;
  createdAt?: string;
};

/**
 * Busca un usuario por RUT en Airtable.
 * Retorna null si no existe.
 */
export async function findUserByRut(rut: string): Promise<AirtableUser | null> {
  const formula = encodeURIComponent(`{rut} = '${rut}'`);
  const url = `${baseUrl()}?filterByFormula=${formula}&maxRecords=1`;

  const res = await fetch(url, { headers: headers(), cache: "no-store" });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable findUserByRut error: ${res.status} - ${body}`);
  }

  const data = await res.json();
  const record = data.records?.[0];
  if (!record) return null;

  return {
    id: record.id,
    rut: record.fields.rut,
    passwordHash: record.fields.passwordHash,
    nombre: record.fields.nombre,
    email: record.fields.email,
    createdAt: record.fields.createdAt,
  };
}

/**
 * Crea un nuevo usuario en Airtable.
 */
export async function createUser(fields: {
  rut: string;
  passwordHash: string;
  nombre?: string;
  email?: string;
}): Promise<AirtableUser> {
  const res = await fetch(baseUrl(), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      records: [
        {
          fields: {
            rut: fields.rut,
            passwordHash: fields.passwordHash,
            nombre: fields.nombre ?? "",
            email: fields.email ?? "",
            createdAt: new Date().toISOString(),
          },
        },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable createUser error: ${res.status} - ${body}`);
  }

  const data = await res.json();
  const record = data.records[0];

  return {
    id: record.id,
    rut: record.fields.rut,
    passwordHash: record.fields.passwordHash,
    nombre: record.fields.nombre,
    email: record.fields.email,
    createdAt: record.fields.createdAt,
  };
}
