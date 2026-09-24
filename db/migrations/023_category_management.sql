-- 023_category_management.sql
--
-- Migration 018 let providers create a service/business category on
-- the fly by simply typing a new name into the "create service"/
-- "create business" forms (ServiceCatalogueService.resolveCategory,
-- BusinessCategoryService.resolve) -- that's still the intended path
-- for a provider. This migration adds the platform-admin counterpart:
-- a dedicated way for an administrator to add a category directly,
-- without going through either of those forms, via a new
-- 'category.manage' permission granted to the administrator platform
-- role (role_id 6, see migration 005's platform_role_assignment
-- table). Same "new permission id, grant to administrator" shape as
-- migration 005 itself.

BEGIN;

INSERT INTO permission (id, code) VALUES
  (20, 'category.manage');

INSERT INTO role_permission (role_id, permission_id)
  SELECT 6, id FROM permission WHERE code = 'category.manage';

COMMIT;
