/**
 * SCAC code to carrier full name mapping
 */
export const CARRIER_NAMES: Record<string, string> = {
  "COSU": "COSCO Shipping",
  "MAEU": "Maersk",
  "MSCU": "MSC - Mediterranean Shipping",
  "CMDU": "CMA CGM",
  "HLCU": "Hapag-Lloyd",
  "ONEY": "ONE - Ocean Network Express",
  "EGLV": "Evergreen",
  "YMLU": "Yang Ming",
  "HDMU": "HMM - Hyundai Merchant Marine",
  "ZIMU": "ZIM",
  "OOLU": "OOCL - Orient Overseas",
  "WHLC": "Wan Hai Lines",
  "SUDU": "Hamburg Süd",
  "ANNU": "ANL Container Line",
  "APLU": "APL",
  "CSAV": "CSAV",
  "CCLU": "China Container Line",
  "SMLM": "SM Line",
  "PCIU": "Pacific International Lines",
  "MOLU": "MOL - Mitsui O.S.K. Lines",
  "NYKS": "NYK Line",
  "KHLU": "K Line",
};

export function getCarrierName(scac: string): string {
  return CARRIER_NAMES[scac] || scac;
}
