-- 024_provider_license_number.sql
--
-- Optional professional license/registration number a provider or
-- artisan can record on their own business profile (tenant row).
-- Purely informational at this stage -- not surfaced to customers,
-- not validated against any registry, and never required. See
-- TenancyController's new PATCH :tenantId route and
-- BusinessService.updateLicenseNumber().

BEGIN;

ALTER TABLE tenant ADD COLUMN license_number text;

COMMIT;
