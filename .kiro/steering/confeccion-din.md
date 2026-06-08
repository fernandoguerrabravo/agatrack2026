---
inclusion: manual
---

# Base de Conocimientos — Confección de Declaración de Ingreso (DIN)

## Sistema AduanaNet

La DIN se confecciona en el sistema AduanaNet (fguerragodoy.aduananet2.cl), un sistema PHP clásico con autenticación por cookies de sesión. Cada módulo es un formulario que se graba con POST + comando=U (o M para Valores Generales).

## Flujo Completo de Módulos (en orden)

1. **Encabezado** (`dus_encabezado.php`) — precargado, no se modifica
2. **Valores Factura** (`din_valores_generales.php`) — montos FOB/Flete/Seguro/CIF
3. **Identificación** (`dus_identificacion.php`) — consignante (emisor de factura)
4. **Destino y Transporte** (`dus_destino.php`) — puertos, nave, naviera, manifiesto, BL
5. **Antecedentes Financieros** (`dus_antecedentes.php`) — régimen, incoterm, días, CO
6. **Mercancía** (`din_mercancia.php`) — ítems arancelarios (repetir por cada ítem)
7. **Bultos** (`dus_desc_bulto.php`) — descripción contenedores + popup tipo bulto
8. **Cuentas y Valores** (`dus_ctas_valores.php`) — impuestos (traer cuentas + aceptar)

---

## Módulo 2: Valores Factura

**URL:** `/modulos/din/dus_encabezado/din_valores_generales.php`
**Guardado:** POST a `grabar.php` con `comando=M`

### Campos a llenar:
- `term_compra` = código incoterm (1=CIF, 2=CFR, 11=CPT, 3=EXW, 5=FOB, 7=FCA, 9=DDP)
- `moneda_desc` = 13 (USD siempre)
- `dus_peso_bruto_total` = peso bruto del BL
- `dus_total_neto_item` = monto total factura
- `dus_total_neto_factura` = monto total factura
- `dus_valor_flete_fac` / `dus_valor_flete` = flete
- `dus_valor_flete_mon` = 13 (USD), `dus_valor_flete_paridad` = 1
- `dus_valor_seguro_fac` / `dus_valor_seguro` = prima de la póliza
- `dus_valor_seguro_mon` = 13 (USD), `dus_valor_seguro_paridad` = 1

### Reglas de cálculo FOB/CIF según incoterm:
- **CFR/CPT:** FOB = factura - flete; CIF = FOB + flete + seguro
- **FOB:** FOB = factura; CIF = FOB + flete + seguro
- **CIF:** CIF = factura; FOB = CIF - flete - seguro
- **EXW:** FOB = ex_fabrica + gastos_hasta_fob; CIF = FOB + flete + seguro

### Fuente del flete (CFR):
- Sumar TODO lo prepaid del BL (`flete_total_prepaid`) + gastos hasta FOB (`gastos_fob_total`)

### Fuente del seguro:
- Prima de la póliza (`poliza.prima` o `poliza.marcas_y_numeros.prima`)
- Si no hay póliza: seguro teórico 2% sobre FOB

---

## Módulo 3: Identificación

**URL:** `/modulos/din/dus_encabezado/dus_identificacion.php`
**Guardado:** `comando=U`

### Campo a llenar:
- **Consignante** = emisor/proveedor de la factura comercial
- Buscar: `/modulos/general/ventanas/listados/consignante.php?identificador=&fil_csg_nombre={NOMBRE}`
- Devuelve: `seleccion('csg_id','nombre','pai_id','pai_nombre','cli_id','direccion')`
- Si hay varios: tomar el de ID más alto
- Si no existe: crear en `/modulos/mantenedores/consignatario/formulario.php?accion=N&cli_id={cli_id}`
- Campos: `csg_id`, `csg_nombre`, `dus_nombre_consignatario`, `csg_direccion`, `pai_id`

---

## Módulo 4: Destino y Transporte

**URL:** `/modulos/din/dus_encabezado/dus_destino.php`
**Guardado:** `comando=U`

### Campos:
- `pai_id_origen` / `pai_id_adquisicion` = país del CO o factura (225=USA)
- `via_id` = 1 (marítima)
- **Puerto embarque** (`pue_id`, `pue_nombre`):
  - Usar el **puerto de transbordo** del BL
  - Resolver vía popup: `/modulos/general/otros_puertos.php?identificador=pue_id&modo=desc&valor={NOMBRE}`
  - Si hay varios códigos: usar el que coincida geográficamente con la tabla `puertos` de la BD
  - El nombre debe ser el que devuelve AduanaNet (no el de la BD)
- `din_transbordo`:
  - Si hay transbordo Y hay tratado (reg_id ≠ 1) → **"P"**
  - Si no → vacío
- **Nave** (`nav_id`, `nav_nombre`):
  - Usar `bl.nave_corregida`
  - Buscar: `/modulos/general/ventanas/listados/nave.php?identificador=&fil_nav_nombre={NOMBRE}`
  - Si no existe → crear en mantenedores/nave.php con comando=N
- **Naviera** (`cia_id`, `dus_nombre_cia_transp`, `pai_idcia`, `dus_rut_cia_transp`):
  - Usar `bl.naviera`
  - Buscar en array `arrcia_id` de la página: nombre más largo + último creado (código más alto)
  - Obtener país/RUT: `/modulos/general/getXML/transportista.php?tra_id={cia_id}`
- **Emisor documento transporte**:
  - Si no hay HBL → misma naviera
  - Si hay HBL → buscar el forwarder
- **Manifiesto** (`din_manifiesto1`, `din_fec_manifiesto`):
  - Buscar en comext.aduana.cl por viaje EXACTO en puerto de desembarque
  - Si es tio_id=151 (ANTIC.) → no poner fecha
  - Si no se encuentra → dejar vacío
- **Documento transporte** (`din_nro_docto_transp`):
  - Master + (H)House concatenados
  - Fecha: priorizar `shipped_on_board_date`, luego `fecha_emision`

---

## Módulo 5: Antecedentes Financieros

**URL:** `/modulos/din/dus_encabezado/dus_antecedentes.php`
**Guardado:** `comando=U`

### Campos fijos:
- `bcc_id` = vacío siempre
- `fpg_id` = 4 (Sp/IVA C) siempre
- `mda_id` = 13 (USD) siempre
- `div_id` = vacío siempre
- `fpa_id` = 1 (COB1)

### Campos calculados:
- `reg_id` = según tratado del CO (resolverRegimen). Sin CO → 1 (GENERAL)
- `cvt_id` = debe coincidir con `term_compra` de Valores Generales
- `din_dias` = días entre fecha emisión factura y fecha vencimiento pago (+1 día). Default: 60
- `din_valor_ex_fabrica` = valor factura solo si EXW, sino 0.00
- `din_gastos_hasta_fob` = solo si EXW con gastos, sino 0.00

### Certificado de Origen (solo si reg_id ≠ 1):
- `cert_orig_tipo` = "c" (independiente) o "f" (en factura, solo Chile-UE)
- `cert_numero` = del documento CO o "S/N"
- `cert_fecha` = `representante_legal_autorizado.fecha_firma` o `fecha_emision` del CO

---

## Módulo 6: Mercancía

**URL:** `/modulos/din/dus_encabezado/din_mercancia.php`
**Guardado:** `comando=U` (repetir por cada ítem)

### Flujo por ítem:
1. `linea = ""` (crear nuevo)
2. Buscar descriptor: `/inc/getXML/buscar_descriptores.php?partida=&codigo={cod}&descripcion=&cli_id={cli_id}`
3. Seleccionar último producto del select
4. Popup descriptor: cantidad según unidad de venta → "Solo a Despacho"
5. Seleccionar acuerdo comercial (del TLC/CO)
6. Consultar arancel: `/modulos/din/dus_encabezado/consulta_arancel_json.php?partida={}&pais={}&regimen={}`
   - Tomar fila VUESA2002: `seleccionar(advalorem, cod_arancel, nro_acuerdo, correlativo)`
7. Cálculo Valores Item (popup): valor total ítem según cláusula + cantidad UME
8. Cálculo de Derechos (popup): solo aceptar
9. Grabar Mercadería

### Campos clave:
- `mer_cod_arancel` = partida arancelaria del CO/descriptor
- `mer_cod_arancel_tratado` = código de la consulta arancel (VUESA2002)
- `mer_nro_acuerdo_comercial` = nro acuerdo del tratado
- `mer_nombre` = `{codigo};{descripcion};{marca};{modelo};{presentacion}`
- `ume_id` = 6 (K.NETO generalmente)
- `mer_cantidad` = peso neto en KG
- `mer_fob_unitario` = (total_neto_item / total_factura) * FOB_total / cantidad
- `mer_valor_cif_item` = total_neto_item * cif_neto
- `mer_porc_otro1` = 19.000 (IVA), `mer_cod_otro1` = 178
- `mer_obs1` = cantidad formateada en KG (ej: "00010800.000000 KG")

---

## Módulo 7: Bultos

**URL:** `/modulos/din/dus_encabezado/dus_desc_bulto.php`
**Guardado:** `comando=U`

### Campos:
- `din_id_bultos` (textarea):
  ```
  {NUMERO_CONTENEDOR}
  CONT llevan {pallets} Pallets (80) con {cantidad} {TIPO_BULTO_ES}({codigo_bulto})
  ```
- `din_obs_banco_sna` (textarea):
  ```
  CERTIFICADO DE ORIGEN {numero} FECHA {fecha}
  Mandato FEA
  ```
  (La nave la agrega AduanaNet automáticamente)

### Popup bultos (`dus_bulto.php`):
- POST con tipo contenedor (74=CONT40, 73=CONT20) y cantidad

### Tipos de bulto (en español):
- 80 = PALLET
- 64 = BOLSA (bags, plastic bags)
- 62 = SACO (sack)
- 45 = TAMBOR (drum)
- 22 = CAJACARTON (carton)
- 93 = BULTONOESP (octabin, IBC, big bag)
- 74 = CONT40
- 73 = CONT20

---

## Módulo 8: Cuentas y Valores

**URL:** `/modulos/din/dus_encabezado/dus_ctas_valores.php`
**Guardado:** `comando=U`

### Proceso:
1. Cargar página (trae `arr_ctas` con cuentas precalculadas desde mercancía)
2. Parsear `arr_ctas[n][0]` (código) y `arr_ctas[n][1]` (valor)
3. Aplicar a campos `dus_codigo1..8` / `dus_valor1..8` (solo cuentas que NO son 178)
4. IVA (178) va en su campo propio `dus_valor178`
5. Total (191) = `dus_valor191`
6. CLP (91) = total * tipo_cambio
7. POST con comando=U

---

## Regímenes por Tratado (Certificado de Origen)

| País/Tratado | reg_id | Nombre |
|---|---|---|
| USA/Estados Unidos | 92 | TLCCH-USA |
| Unión Europea | 91 | AICCH-UE |
| China | 96 | TLC-CHCHI |
| Corea | 93 | TLCCH-COR |
| Japón | 98 | AAEECH-JAP |
| India | 97 | AAPCH-IND |
| Canadá | 73 | TLCCHC |
| México | 75 | TLCCH-M |
| Colombia | 64 | ALCCH-COL |
| Australia | 63 | TLCCH-AUS |
| Sin CO | 1 | GENERAL |

---

## Fuentes de Datos por Documento

| Campo DIN | Invoice | BL | CO | Póliza |
|---|---|---|---|---|
| Monto total | ✅ monto_total | | | |
| FOB | ✅ fob_value | | | |
| Flete | freight_value | ✅ flete_total_prepaid + gastos_fob_total | | |
| Seguro | | | | ✅ prima (marcas_y_numeros.prima) |
| Incoterm | ✅ incoterm | | | |
| Peso bruto | | ✅ peso_bruto_total | | |
| Nave | | ✅ nave_corregida | | |
| Viaje | | ✅ viaje_corregido | | |
| Naviera | | ✅ naviera | | |
| Puerto transbordo | | ✅ puerto_transbordo | | |
| Contenedores | | ✅ contenedores[] | | |
| Nro BL | | ✅ numero_bl_master | | |
| Fecha BL | | ✅ shipped_on_board_date > fecha_emision | | |
| País origen | | | ✅ pais_origen | |
| Tratado | | | ✅ tratado_aplicable | |
| Arancel | | | ✅ mercancia.clasificacion_arancelaria_hs | |
| Proveedor | ✅ proveedor.nombre | | | |
| Items/productos | ✅ items[] | | | |
| Días cobranza | ✅ fecha + fecha_vencimiento_pago | | | |
| Cert. número | | | ✅ numero_certificado o "S/N" | |
| Cert. fecha | | | ✅ representante_legal_autorizado.fecha_firma | |

---

## Validaciones para Confeccionar

Requisitos mínimos para activar el botón "Enviar a Confección":
1. Debe existir **Bill of Lading (BL)**
2. Debe existir **Invoice (Factura Comercial)**
3. El BL debe estar **corregido** (tener `nave_corregida` o `viaje_corregido` o `datos_shipsgo`)

Validación adicional del API:
- Confirmar que es el BL corregido (SweetAlert paso 1)
- Confirmar envío a confección (SweetAlert paso 2)
