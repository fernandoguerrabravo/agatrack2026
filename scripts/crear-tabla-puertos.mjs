#!/usr/bin/env node
/** Crea la tabla puertos en PostgreSQL con los códigos oficiales de Aduana Chile */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = fs.readFileSync(path.join(__dirname, "..", ".env"), "utf-8");
const get = (k) => { const m = env.match(new RegExp("^" + k + "=(.*)$", "m")); let v = m ? m[1].trim() : ""; if (v.startsWith('"')) v = v.slice(1, -1); return v; };
const POSTGRES_URL = get("POSTGRES_URL").replace(/[?&]sslmode=[^&]*/g, "");

const pool = new pg.Pool({ connectionString: POSTGRES_URL, ssl: { rejectUnauthorized: false } });

// Puertos del Anexo 51 — Compendio Normas Aduaneras Chile
const PUERTOS = [
  // CANADÁ
  { codigo: "111", nombre: "MONTREAL", pais: "CANADA", nacional: false },
  { codigo: "112", nombre: "COSTA DEL PACIFICO, OTROS NO ESPECIFICADOS", pais: "CANADA", nacional: false },
  { codigo: "113", nombre: "HALIFAX", pais: "CANADA", nacional: false },
  { codigo: "114", nombre: "VANCOUVER", pais: "CANADA", nacional: false },
  { codigo: "115", nombre: "SAINT JOHN", pais: "CANADA", nacional: false },
  { codigo: "116", nombre: "TORONTO", pais: "CANADA", nacional: false },
  { codigo: "117", nombre: "OTROS PUERTOS DE CANADA NO IDENTIFICADOS", pais: "CANADA", nacional: false },
  { codigo: "118", nombre: "BAYSIDE", pais: "CANADA", nacional: false },
  { codigo: "120", nombre: "PORT CARTIES", pais: "CANADA", nacional: false },
  { codigo: "124", nombre: "QUEBEC", pais: "CANADA", nacional: false },
  { codigo: "125", nombre: "PRINCE RUPERT", pais: "CANADA", nacional: false },
  { codigo: "126", nombre: "HAMILTON", pais: "CANADA", nacional: false },
  // ESTADOS UNIDOS - ATLANTICO
  { codigo: "131", nombre: "BOSTON", pais: "USA", nacional: false },
  { codigo: "132", nombre: "NEW HAVEN", pais: "USA", nacional: false },
  { codigo: "133", nombre: "BRIDGEPORT", pais: "USA", nacional: false },
  { codigo: "134", nombre: "NEW YORK", pais: "USA", nacional: false },
  { codigo: "135", nombre: "FILADELFIA", pais: "USA", nacional: false },
  { codigo: "136", nombre: "BALTIMORE", pais: "USA", nacional: false },
  { codigo: "137", nombre: "NORFOLK", pais: "USA", nacional: false },
  { codigo: "139", nombre: "CHARLESTON", pais: "USA", nacional: false },
  { codigo: "140", nombre: "SAVANAH", pais: "USA", nacional: false },
  { codigo: "141", nombre: "MIAMI", pais: "USA", nacional: false },
  { codigo: "121", nombre: "COSTA DEL ATLANTICO, OTROS NO ESPECIFICADOS", pais: "USA", nacional: false },
  { codigo: "142", nombre: "EVERGLADES", pais: "USA", nacional: false },
  { codigo: "143", nombre: "JACKSONVILLE", pais: "USA", nacional: false },
  { codigo: "145", nombre: "PALM BEACH", pais: "USA", nacional: false },
  { codigo: "146", nombre: "BATON ROUGE", pais: "USA", nacional: false },
  { codigo: "147", nombre: "COLUMBRES", pais: "USA", nacional: false },
  { codigo: "148", nombre: "PITTSBURGH", pais: "USA", nacional: false },
  { codigo: "149", nombre: "DULUTH", pais: "USA", nacional: false },
  { codigo: "150", nombre: "MILWAUKEE", pais: "USA", nacional: false },
  // USA - GOLFO
  { codigo: "151", nombre: "TAMPA", pais: "USA", nacional: false },
  { codigo: "152", nombre: "PENSACOLA", pais: "USA", nacional: false },
  { codigo: "153", nombre: "MOBILE", pais: "USA", nacional: false },
  { codigo: "154", nombre: "NEW ORLEANS", pais: "USA", nacional: false },
  { codigo: "155", nombre: "PORT ARTHUR", pais: "USA", nacional: false },
  { codigo: "156", nombre: "GALVESTON", pais: "USA", nacional: false },
  { codigo: "157", nombre: "CORPUS CRISTI", pais: "USA", nacional: false },
  { codigo: "158", nombre: "BROWNSVILLE", pais: "USA", nacional: false },
  { codigo: "159", nombre: "HOUSTON", pais: "USA", nacional: false },
  { codigo: "122", nombre: "PUERTOS DEL GOLFO DE MEXICO, OTROS NO ESPECIFICADOS", pais: "USA", nacional: false },
  // USA - PACIFICO
  { codigo: "171", nombre: "SEATTLE", pais: "USA", nacional: false },
  { codigo: "172", nombre: "PORTLAND", pais: "USA", nacional: false },
  { codigo: "173", nombre: "SAN FRANCISCO", pais: "USA", nacional: false },
  { codigo: "174", nombre: "LOS ANGELES", pais: "USA", nacional: false },
  { codigo: "175", nombre: "LONG BEACH", pais: "USA", nacional: false },
  { codigo: "176", nombre: "SAN DIEGO", pais: "USA", nacional: false },
  { codigo: "123", nombre: "COSTA DEL PACIFICO, OTROS NO ESPECIFICADOS", pais: "USA", nacional: false },
  { codigo: "160", nombre: "OAKLAND", pais: "USA", nacional: false },
  { codigo: "161", nombre: "STOCKTON", pais: "USA", nacional: false },
  { codigo: "180", nombre: "OTROS PUERTOS DE ESTADOS UNIDOS NO ESPECIFICADOS", pais: "USA", nacional: false },
  // MEXICO
  { codigo: "211", nombre: "TAMPICO", pais: "MEXICO", nacional: false },
  { codigo: "213", nombre: "VERACRUZ", pais: "MEXICO", nacional: false },
  { codigo: "214", nombre: "COATZACOALCOS", pais: "MEXICO", nacional: false },
  { codigo: "215", nombre: "GUAYMAS", pais: "MEXICO", nacional: false },
  { codigo: "216", nombre: "MAZATLAN", pais: "MEXICO", nacional: false },
  { codigo: "217", nombre: "MANZANILLO", pais: "MEXICO", nacional: false },
  { codigo: "218", nombre: "ACAPULCO", pais: "MEXICO", nacional: false },
  { codigo: "210", nombre: "OTROS PUERTOS DE MEXICO NO ESPECIFICADOS", pais: "MEXICO", nacional: false },
  { codigo: "220", nombre: "ALTAMIRA", pais: "MEXICO", nacional: false },
  // PANAMA
  { codigo: "221", nombre: "CRISTOBAL", pais: "PANAMA", nacional: false },
  { codigo: "222", nombre: "BALBOA", pais: "PANAMA", nacional: false },
  { codigo: "223", nombre: "COLON", pais: "PANAMA", nacional: false },
  { codigo: "224", nombre: "OTROS PUERTOS DE PANAMA NO ESPECIFICADOS", pais: "PANAMA", nacional: false },
  // COLOMBIA
  { codigo: "232", nombre: "BUENAVENTURA", pais: "COLOMBIA", nacional: false },
  { codigo: "231", nombre: "OTROS PUERTOS DE COLOMBIA NO ESPECIFICADOS", pais: "COLOMBIA", nacional: false },
  { codigo: "233", nombre: "BARRANQUILLA", pais: "COLOMBIA", nacional: false },
  // ECUADOR
  { codigo: "242", nombre: "GUAYAQUIL", pais: "ECUADOR", nacional: false },
  { codigo: "241", nombre: "OTROS PUERTOS DE ECUADOR NO ESPECIFICADOS", pais: "ECUADOR", nacional: false },
  // PERU
  { codigo: "252", nombre: "CALLAO", pais: "PERU", nacional: false },
  { codigo: "253", nombre: "ILO", pais: "PERU", nacional: false },
  { codigo: "254", nombre: "IQUITOS", pais: "PERU", nacional: false },
  { codigo: "251", nombre: "OTROS PUERTOS DE PERU NO ESPECIFICADOS", pais: "PERU", nacional: false },
  // ARGENTINA
  { codigo: "262", nombre: "BUENOS AIRES", pais: "ARGENTINA", nacional: false },
  { codigo: "263", nombre: "NECOCHEA", pais: "ARGENTINA", nacional: false },
  { codigo: "264", nombre: "MENDOZA", pais: "ARGENTINA", nacional: false },
  { codigo: "265", nombre: "CORDOBA", pais: "ARGENTINA", nacional: false },
  { codigo: "261", nombre: "OTROS PUERTOS DE ARGENTINA NO ESPECIFICADOS", pais: "ARGENTINA", nacional: false },
  { codigo: "266", nombre: "BAHIA BLANCA", pais: "ARGENTINA", nacional: false },
  { codigo: "267", nombre: "COMODORO RIVADAVIA", pais: "ARGENTINA", nacional: false },
  { codigo: "268", nombre: "PUERTO MADRYN", pais: "ARGENTINA", nacional: false },
  { codigo: "269", nombre: "MAR DEL PLATA", pais: "ARGENTINA", nacional: false },
  { codigo: "270", nombre: "ROSARIO", pais: "ARGENTINA", nacional: false },
  // URUGUAY
  { codigo: "272", nombre: "MONTEVIDEO", pais: "URUGUAY", nacional: false },
  { codigo: "271", nombre: "OTROS PUERTOS DE URUGUAY NO ESPECIFICADOS", pais: "URUGUAY", nacional: false },
  // VENEZUELA
  { codigo: "282", nombre: "LA GUAIRA", pais: "VENEZUELA", nacional: false },
  { codigo: "281", nombre: "OTROS PUERTOS DE VENEZUELA NO ESPECIFICADOS", pais: "VENEZUELA", nacional: false },
  { codigo: "285", nombre: "MARACAIBO", pais: "VENEZUELA", nacional: false },
  // BRASIL
  { codigo: "292", nombre: "SANTOS", pais: "BRASIL", nacional: false },
  { codigo: "293", nombre: "RIO DE JANEIRO", pais: "BRASIL", nacional: false },
  { codigo: "294", nombre: "RIO GRANDE DEL SUR", pais: "BRASIL", nacional: false },
  { codigo: "295", nombre: "PARANAGUA", pais: "BRASIL", nacional: false },
  { codigo: "296", nombre: "SAO PAULO", pais: "BRASIL", nacional: false },
  { codigo: "297", nombre: "SALVADOR", pais: "BRASIL", nacional: false },
  { codigo: "291", nombre: "OTROS PUERTOS DE BRASIL NO ESPECIFICADOS", pais: "BRASIL", nacional: false },
  // ANTILLAS / AMERICA OTROS
  { codigo: "302", nombre: "CURAZAO", pais: "ANTILLAS", nacional: false },
  { codigo: "301", nombre: "OTROS PUERTOS DE LAS ANTILLAS HOLANDESAS NO ESPECIFICADOS", pais: "ANTILLAS", nacional: false },
  { codigo: "399", nombre: "OTROS PUERTOS DE AMERICA NO ESPECIFICADOS", pais: "AMERICA", nacional: false },
  // CHINA
  { codigo: "411", nombre: "SHANGAI", pais: "CHINA", nacional: false },
  { codigo: "412", nombre: "DAIREN", pais: "CHINA", nacional: false },
  { codigo: "413", nombre: "OTROS PUERTOS DE CHINA NO ESPECIFICADOS", pais: "CHINA", nacional: false },
  // COREA
  { codigo: "421", nombre: "NAMPO", pais: "COREA DEL NORTE", nacional: false },
  { codigo: "420", nombre: "OTROS PUERTOS DE COREA DEL NORTE NO ESPECIFICADOS", pais: "COREA DEL NORTE", nacional: false },
  { codigo: "422", nombre: "BUSAN", pais: "COREA DEL SUR", nacional: false },
  { codigo: "423", nombre: "OTROS PUERTOS DE COREA DEL SUR NO ESPECIFICADOS", pais: "COREA DEL SUR", nacional: false },
  // FILIPINAS
  { codigo: "431", nombre: "MANILA", pais: "FILIPINAS", nacional: false },
  { codigo: "432", nombre: "OTROS PUERTOS DE FILIPINAS NO ESPECIFICADOS", pais: "FILIPINAS", nacional: false },
  // JAPON
  { codigo: "442", nombre: "OSAKA", pais: "JAPON", nacional: false },
  { codigo: "443", nombre: "KOBE", pais: "JAPON", nacional: false },
  { codigo: "444", nombre: "YOKOHAMA", pais: "JAPON", nacional: false },
  { codigo: "445", nombre: "NAGOYA", pais: "JAPON", nacional: false },
  { codigo: "446", nombre: "SHIMIZUI", pais: "JAPON", nacional: false },
  { codigo: "447", nombre: "MOJI", pais: "JAPON", nacional: false },
  { codigo: "448", nombre: "YAWATA", pais: "JAPON", nacional: false },
  { codigo: "449", nombre: "FUKUYAMA", pais: "JAPON", nacional: false },
  { codigo: "441", nombre: "OTROS PUERTOS DE JAPON NO ESPECIFICADOS", pais: "JAPON", nacional: false },
  // TAIWAN
  { codigo: "451", nombre: "KAOHSIUNG", pais: "TAIWAN", nacional: false },
  { codigo: "452", nombre: "KEELUNG", pais: "TAIWAN", nacional: false },
  { codigo: "453", nombre: "OTROS PUERTOS DE TAIWAN NO ESPECIFICADOS", pais: "TAIWAN", nacional: false },
  // IRAN
  { codigo: "461", nombre: "KARHG ISLAND", pais: "IRAN", nacional: false },
  { codigo: "462", nombre: "OTROS PUERTOS DE IRAN NO ESPECIFICADOS", pais: "IRAN", nacional: false },
  // INDIA
  { codigo: "471", nombre: "CALCUTA", pais: "INDIA", nacional: false },
  { codigo: "472", nombre: "OTROS PUERTOS DE INDIA NO ESPECIFICADOS", pais: "INDIA", nacional: false },
  // BANGLADESH
  { codigo: "481", nombre: "CHALNA", pais: "BANGLADESH", nacional: false },
  { codigo: "482", nombre: "OTROS PUERTOS DE BANGLADESH NO ESPECIFICADOS", pais: "BANGLADESH", nacional: false },
  // HONG KONG / SINGAPUR / ASIA OTROS
  { codigo: "492", nombre: "HONG KONG", pais: "HONG KONG", nacional: false },
  { codigo: "491", nombre: "OTROS PUERTOS DE SINGAPUR NO ESPECIFICADOS", pais: "SINGAPUR", nacional: false },
  { codigo: "499", nombre: "OTROS PUERTOS ASIATICOS NO ESPECIFICADOS", pais: "ASIA", nacional: false },
  // EUROPA
  { codigo: "511", nombre: "CONSTANZA", pais: "RUMANIA", nacional: false },
  { codigo: "512", nombre: "OTROS PUERTOS DE RUMANIA NO ESPECIFICADOS", pais: "RUMANIA", nacional: false },
  { codigo: "521", nombre: "VARNA", pais: "BULGARIA", nacional: false },
  { codigo: "522", nombre: "OTROS PUERTOS DE BULGARIA NO ESPECIFICADOS", pais: "BULGARIA", nacional: false },
  { codigo: "538", nombre: "RIJEKA", pais: "CROACIA", nacional: false },
  { codigo: "537", nombre: "OTROS PUERTOS DE CROACIA NO ESPECIFICADOS", pais: "CROACIA", nacional: false },
  { codigo: "533", nombre: "BELGRADO", pais: "SERBIA", nacional: false },
  { codigo: "534", nombre: "OTROS PUERTOS DE SERBIA NO ESPECIFICADOS", pais: "SERBIA", nacional: false },
  { codigo: "535", nombre: "PODGORITSA", pais: "MONTENEGRO", nacional: false },
  { codigo: "536", nombre: "OTROS PUERTOS DE MONTENEGRO NO ESPECIFICADOS", pais: "MONTENEGRO", nacional: false },
  // ITALIA
  { codigo: "542", nombre: "GENOVA", pais: "ITALIA", nacional: false },
  { codigo: "543", nombre: "LIORNA", pais: "ITALIA", nacional: false },
  { codigo: "544", nombre: "NAPOLES", pais: "ITALIA", nacional: false },
  { codigo: "545", nombre: "SALERNO", pais: "ITALIA", nacional: false },
  { codigo: "546", nombre: "AUGUSTA", pais: "ITALIA", nacional: false },
  { codigo: "547", nombre: "SAVONA", pais: "ITALIA", nacional: false },
  { codigo: "541", nombre: "OTROS PUERTOS DE ITALIA NO ESPECIFICADOS", pais: "ITALIA", nacional: false },
  // FRANCIA
  { codigo: "552", nombre: "LA PALLICE", pais: "FRANCIA", nacional: false },
  { codigo: "553", nombre: "LE HAVRE", pais: "FRANCIA", nacional: false },
  { codigo: "554", nombre: "MARSELLA", pais: "FRANCIA", nacional: false },
  { codigo: "551", nombre: "OTROS PUERTOS DE FRANCIA NO ESPECIFICADOS", pais: "FRANCIA", nacional: false },
  { codigo: "555", nombre: "BURDEOS", pais: "FRANCIA", nacional: false },
  { codigo: "556", nombre: "CALAIS", pais: "FRANCIA", nacional: false },
  { codigo: "557", nombre: "BREST", pais: "FRANCIA", nacional: false },
  { codigo: "558", nombre: "RUAN", pais: "FRANCIA", nacional: false },
  // ESPAÑA
  { codigo: "562", nombre: "CADIZ", pais: "ESPANA", nacional: false },
  { codigo: "563", nombre: "BARCELONA", pais: "ESPANA", nacional: false },
  { codigo: "564", nombre: "BILBAO", pais: "ESPANA", nacional: false },
  { codigo: "565", nombre: "HUELVA", pais: "ESPANA", nacional: false },
  { codigo: "566", nombre: "SEVILLA", pais: "ESPANA", nacional: false },
  { codigo: "561", nombre: "OTROS PUERTOS DE ESPANA NO ESPECIFICADOS", pais: "ESPANA", nacional: false },
  { codigo: "567", nombre: "TARRAGONA", pais: "ESPANA", nacional: false },
  { codigo: "568", nombre: "ALGECIRAS", pais: "ESPANA", nacional: false },
  { codigo: "569", nombre: "VALENCIA", pais: "ESPANA", nacional: false },
  // REINO UNIDO
  { codigo: "571", nombre: "LIVERPOOL", pais: "REINO UNIDO", nacional: false },
  { codigo: "572", nombre: "LONDRES", pais: "REINO UNIDO", nacional: false },
  { codigo: "573", nombre: "ROCHESTER", pais: "REINO UNIDO", nacional: false },
  { codigo: "576", nombre: "OTROS PUERTOS DE INGLATERRA NO ESPECIFICADOS", pais: "REINO UNIDO", nacional: false },
  { codigo: "577", nombre: "DOVER", pais: "REINO UNIDO", nacional: false },
  { codigo: "578", nombre: "PLYMOUTH", pais: "REINO UNIDO", nacional: false },
  // ALEMANIA
  { codigo: "591", nombre: "BREMEN", pais: "ALEMANIA", nacional: false },
  { codigo: "592", nombre: "HAMBURGO", pais: "ALEMANIA", nacional: false },
  { codigo: "593", nombre: "NUREMBERG", pais: "ALEMANIA", nacional: false },
  { codigo: "594", nombre: "FRANKFURT", pais: "ALEMANIA", nacional: false },
  { codigo: "595", nombre: "DUSSELDORF", pais: "ALEMANIA", nacional: false },
  { codigo: "596", nombre: "OTROS PUERTOS DE ALEMANIA NO ESPECIFICADOS", pais: "ALEMANIA", nacional: false },
  { codigo: "597", nombre: "CUXHAVEN", pais: "ALEMANIA", nacional: false },
  { codigo: "598", nombre: "ROSTOCK", pais: "ALEMANIA", nacional: false },
  // BELGICA
  { codigo: "601", nombre: "AMBERES", pais: "BELGICA", nacional: false },
  { codigo: "602", nombre: "OTROS PUERTOS DE BELGICA NO ESPECIFICADOS", pais: "BELGICA", nacional: false },
  { codigo: "603", nombre: "ZEEBRUGGE", pais: "BELGICA", nacional: false },
  { codigo: "604", nombre: "GHENT", pais: "BELGICA", nacional: false },
  { codigo: "605", nombre: "OOSTENDE", pais: "BELGICA", nacional: false },
  // PAISES BAJOS
  { codigo: "621", nombre: "AMSTERDAM", pais: "PAISES BAJOS", nacional: false },
  { codigo: "622", nombre: "ROTTERDAM", pais: "PAISES BAJOS", nacional: false },
  { codigo: "623", nombre: "OTROS PUERTOS DE PAISES BAJOS NO ESPECIFICADOS", pais: "PAISES BAJOS", nacional: false },
  // OTROS EUROPA
  { codigo: "699", nombre: "OTROS PUERTOS DE EUROPA NO ESPECIFICADOS", pais: "EUROPA", nacional: false },
  // AFRICA
  { codigo: "711", nombre: "DURBAM", pais: "SUDAFRICA", nacional: false },
  { codigo: "712", nombre: "CIUDAD DEL CABO", pais: "SUDAFRICA", nacional: false },
  { codigo: "713", nombre: "OTROS PUERTOS DE SUDAFRICA NO ESPECIFICADOS", pais: "SUDAFRICA", nacional: false },
  { codigo: "714", nombre: "SALDANHA", pais: "SUDAFRICA", nacional: false },
  { codigo: "715", nombre: "PORT-ELIZABETH", pais: "SUDAFRICA", nacional: false },
  { codigo: "799", nombre: "OTROS PUERTOS DE AFRICA NO ESPECIFICADOS", pais: "AFRICA", nacional: false },
  // OCEANIA
  { codigo: "811", nombre: "SIDNEY", pais: "AUSTRALIA", nacional: false },
  { codigo: "812", nombre: "FREMANTLE", pais: "AUSTRALIA", nacional: false },
  { codigo: "814", nombre: "ADELAIDA", pais: "AUSTRALIA", nacional: false },
  { codigo: "815", nombre: "DARWIN", pais: "AUSTRALIA", nacional: false },
  { codigo: "816", nombre: "GERALDTON", pais: "AUSTRALIA", nacional: false },
  { codigo: "813", nombre: "OTROS PUERTOS DE AUSTRALIA NO ESPECIFICADOS", pais: "AUSTRALIA", nacional: false },
  { codigo: "899", nombre: "OTROS PUERTOS DE OCEANIA NO ESPECIFICADOS", pais: "OCEANIA", nacional: false },
  // CHILE - PUERTOS NACIONALES
  { codigo: "901", nombre: "ARICA", pais: "CHILE", nacional: true },
  { codigo: "902", nombre: "IQUIQUE", pais: "CHILE", nacional: true },
  { codigo: "903", nombre: "ANTOFAGASTA", pais: "CHILE", nacional: true },
  { codigo: "904", nombre: "COQUIMBO", pais: "CHILE", nacional: true },
  { codigo: "905", nombre: "VALPARAISO", pais: "CHILE", nacional: true },
  { codigo: "906", nombre: "SAN ANTONIO", pais: "CHILE", nacional: true },
  { codigo: "907", nombre: "TALCAHUANO", pais: "CHILE", nacional: true },
  { codigo: "908", nombre: "SAN VICENTE", pais: "CHILE", nacional: true },
  { codigo: "909", nombre: "LIRQUEN", pais: "CHILE", nacional: true },
  { codigo: "910", nombre: "PUERTO MONTT", pais: "CHILE", nacional: true },
  { codigo: "911", nombre: "CHACABUCO PUERTO AYSEN", pais: "CHILE", nacional: true },
  { codigo: "912", nombre: "PUNTA ARENAS", pais: "CHILE", nacional: true },
  { codigo: "913", nombre: "PATILLOS", pais: "CHILE", nacional: true },
  { codigo: "914", nombre: "TOCOPILLA", pais: "CHILE", nacional: true },
  { codigo: "915", nombre: "MEJILLONES", pais: "CHILE", nacional: true },
  { codigo: "921", nombre: "QUINTERO", pais: "CHILE", nacional: true },
  { codigo: "926", nombre: "CORONEL", pais: "CHILE", nacional: true },
  { codigo: "930", nombre: "CORRAL", pais: "CHILE", nacional: true },
  { codigo: "936", nombre: "NATALES", pais: "CHILE", nacional: true },
  { codigo: "952", nombre: "ZONA FRANCA IQUIQUE", pais: "CHILE", nacional: true },
  { codigo: "953", nombre: "ZONA FRANCA PUNTA ARENAS", pais: "CHILE", nacional: true },
  { codigo: "997", nombre: "OTROS PUERTOS CHILENOS", pais: "CHILE", nacional: true },
];

(async () => {
  console.log("=== Crear tabla puertos ===\n");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS puertos (
      codigo VARCHAR(5) PRIMARY KEY,
      nombre VARCHAR(150) NOT NULL,
      pais VARCHAR(50) DEFAULT '',
      nacional BOOLEAN DEFAULT FALSE
    )
  `);
  console.log("✅ Tabla creada/verificada");

  let inserted = 0;
  for (const p of PUERTOS) {
    await pool.query(
      `INSERT INTO puertos (codigo, nombre, pais, nacional) VALUES ($1, $2, $3, $4)
       ON CONFLICT (codigo) DO UPDATE SET nombre = $2, pais = $3, nacional = $4`,
      [p.codigo, p.nombre, p.pais, p.nacional]
    );
    inserted++;
  }
  console.log(`✅ ${inserted} puertos insertados/actualizados`);

  const res = await pool.query("SELECT COUNT(*) as total FROM puertos");
  console.log(`Total en tabla: ${res.rows[0].total}`);

  // Verificar algunos
  const check = await pool.query("SELECT * FROM puertos WHERE codigo IN ('252', '399', '906', '139') ORDER BY codigo");
  console.log("\nVerificación:");
  check.rows.forEach(r => console.log(`  ${r.codigo} = ${r.nombre} (${r.pais}, nacional=${r.nacional})`));

  await pool.end();
  console.log("\n✅ Listo.");
})().catch(e => { console.error("ERROR:", e.message); pool.end(); process.exit(1); });
