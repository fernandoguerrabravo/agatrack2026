# Requirements Document

## Introduction

Enhance the existing statistics dashboards for Exportaciones and Importaciones to consistently evaluate every metric breakdown across 3 dimensions: Montos (monetary values — FOB for exports, CIF for imports), Peso (weight in kg), and Cantidad de operaciones (number of operations). Currently, some breakdowns only show 1 or 2 of these dimensions. This feature ensures all breakdown tables and charts expose all 3 dimensions uniformly.

## Glossary

- **Stats_API_Exports**: The API route at `/api/despachos/stats` that returns aggregated statistics for export operations
- **Stats_API_Imports**: The API route at `/api/importaciones/stats` that returns aggregated statistics for import operations
- **Exports_Dashboard**: The statistics page component (`EstadisticasPanel`) rendered at `/dashboard/exportaciones/estadisticas`
- **Imports_Dashboard**: The statistics page component (`ImportacionesStats`) rendered at `/dashboard/importaciones/estadisticas`
- **Montos**: Monetary values — Total FOB (USD) for exports, Total CIF (USD) for imports
- **Peso**: Total gross weight (`total_peso_bruto`) measured in kilograms
- **Cantidad**: Count of operations (number of records matching the grouping)
- **Breakdown**: A grouping of operations by a specific field (e.g., país, aduana, operación, incoterms)

## Requirements

### Requirement 1: Exports API returns 3 dimensions for all breakdowns

**User Story:** As a dashboard user, I want the exports stats API to return montos, peso, and cantidad for every breakdown, so that the frontend can display all 3 dimensions.

#### Acceptance Criteria

1. WHEN the Exports_Dashboard requests statistics, THE Stats_API_Exports SHALL return `total_peso_bruto_sum` (total kg) in the `totals` object alongside `total_operaciones` and `total_fob_sum`
2. WHEN the Exports_Dashboard requests statistics, THE Stats_API_Exports SHALL return `peso_mes` (SUM of total_peso_bruto) in each `porMes` entry alongside `cantidad` and `fob_mes`
3. WHEN the Exports_Dashboard requests statistics, THE Stats_API_Exports SHALL return `peso_total` (SUM of total_peso_bruto) in each `porPais` entry alongside `cantidad` and `fob_total`
4. WHEN the Exports_Dashboard requests statistics, THE Stats_API_Exports SHALL return `peso_total` (SUM of total_peso_bruto) in each `porAduana` entry alongside `cantidad` and `fob_total`
5. WHEN the Exports_Dashboard requests statistics, THE Stats_API_Exports SHALL return `peso_total` (SUM of total_peso_bruto) in each `porOperacion` entry alongside `cantidad` and `fob_total`

### Requirement 2: Imports API returns 3 dimensions for all breakdowns

**User Story:** As a dashboard user, I want the imports stats API to return montos, peso, and cantidad for every breakdown, so that the frontend can display all 3 dimensions.

#### Acceptance Criteria

1. WHEN the Imports_Dashboard requests statistics, THE Stats_API_Imports SHALL return `peso_total` (SUM of total_peso_bruto) in each `porPaisOrigen` entry alongside `cantidad` and `cif_total`
2. WHEN the Imports_Dashboard requests statistics, THE Stats_API_Imports SHALL return `peso_total` (SUM of total_peso_bruto) in each `porAduana` entry alongside `cantidad` and `cif_total`
3. WHEN the Imports_Dashboard requests statistics, THE Stats_API_Imports SHALL return `peso_total` (SUM of total_peso_bruto) in each `porIncoterms` entry alongside `cantidad` and `cif_total`
4. WHEN the Imports_Dashboard requests statistics, THE Stats_API_Imports SHALL return `peso_total` (SUM of total_peso_bruto) in each `porOperacion` entry alongside `cantidad` and `cif_total`

### Requirement 3: Exports Dashboard displays 3 dimensions in breakdown tables

**User Story:** As a dashboard user, I want to see montos, peso, and cantidad columns in every breakdown table on the exports statistics page, so that I can compare operations across all dimensions.

#### Acceptance Criteria

1. THE Exports_Dashboard SHALL display columns for Operaciones (count), FOB Total (USD), and Peso Total (kg) in the "Por Aduana" table
2. THE Exports_Dashboard SHALL display columns for Operaciones (count), FOB Total (USD), and Peso Total (kg) in the "Top 10 Países Destino" breakdown
3. WHEN the "Por Tipo de Operación" data is displayed, THE Exports_Dashboard SHALL show cantidad, FOB total, and peso total for each operation type

### Requirement 4: Imports Dashboard displays 3 dimensions in breakdown tables

**User Story:** As a dashboard user, I want to see montos, peso, and cantidad columns in every breakdown table on the imports statistics page, so that I can compare operations across all dimensions.

#### Acceptance Criteria

1. THE Imports_Dashboard SHALL display columns for Operaciones (count), CIF Total (USD), and Peso Total (kg) in the "Por Aduana" table
2. THE Imports_Dashboard SHALL display columns for Operaciones (count), CIF Total (USD), and Peso Total (kg) in the "Top 10 Países Origen" breakdown
3. THE Imports_Dashboard SHALL display columns for Operaciones (count), CIF Total (USD), and Peso Total (kg) in the "Por Incoterms" table
4. WHEN the "Por Tipo de Operación" data is displayed, THE Imports_Dashboard SHALL show cantidad, CIF total, and peso total for each operation type

### Requirement 5: Exports Dashboard displays peso time series

**User Story:** As a dashboard user, I want to see a peso-over-time chart on the exports statistics page, so that I can track weight trends alongside monetary and count trends.

#### Acceptance Criteria

1. THE Exports_Dashboard SHALL display a "Peso por Mes" line chart showing total_peso_bruto aggregated by month
2. THE Exports_Dashboard SHALL display a "Total Peso" KPI card showing the sum of total_peso_bruto for the selected date range

### Requirement 6: Consistent formatting of dimensions

**User Story:** As a dashboard user, I want all dimension values formatted consistently, so that I can quickly read and compare numbers.

#### Acceptance Criteria

1. THE Exports_Dashboard SHALL format Montos (FOB) values as USD currency with no decimal places
2. THE Imports_Dashboard SHALL format Montos (CIF) values as USD currency with no decimal places
3. THE Exports_Dashboard SHALL format Peso values with thousands separator and "kg" suffix
4. THE Imports_Dashboard SHALL format Peso values with thousands separator and "kg" suffix
5. THE Exports_Dashboard SHALL format Cantidad values as integers with thousands separator
6. THE Imports_Dashboard SHALL format Cantidad values as integers with thousands separator
