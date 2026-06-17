export type SessionPayload = {
  rut: string;
  nombre: string;
  email: string;
  rol: "cliente" | "ejecutivo" | "admin" | "contabilidad";
  /** @deprecated usar 'rol' en su lugar */
  rol_prealertas?: number;
};
