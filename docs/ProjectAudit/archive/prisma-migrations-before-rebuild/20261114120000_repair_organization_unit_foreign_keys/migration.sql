-- 修复 Phase 1 在部分环境遗漏的 organization_units 外键
--
-- 背景：Phase 1 迁移在 user_roles 主键切换处失败后，个别环境只补跑了后续语句，
--       遗漏了 organization_units 的两条外键；迁移文件本身是完整的。
--
-- 本迁移不修改任何历史迁移，只做条件修复：
--   约束已存在（干净库按历史迁移完整执行）时安全跳过；
--   约束缺失（问题环境）时补齐。
-- 通过 information_schema 按「列 + 引用目标」判断，不依赖约束名是否一致。

SET @fk_parent_exists := (
    SELECT COUNT(*)
    FROM information_schema.KEY_COLUMN_USAGE AS k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS AS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND k.TABLE_NAME = 'organization_units'
      AND k.COLUMN_NAME = 'parent_id'
      AND k.REFERENCED_TABLE_NAME = 'organization_units'
      AND k.REFERENCED_COLUMN_NAME = 'id'
);

SET @sql_parent := IF(
    @fk_parent_exists = 0,
    'ALTER TABLE `organization_units` ADD CONSTRAINT `organization_units_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    'DO 0'
);

PREPARE stmt_parent FROM @sql_parent;
EXECUTE stmt_parent;
DEALLOCATE PREPARE stmt_parent;

SET @fk_created_by_exists := (
    SELECT COUNT(*)
    FROM information_schema.KEY_COLUMN_USAGE AS k
    JOIN information_schema.REFERENTIAL_CONSTRAINTS AS r
      ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
     AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     AND r.TABLE_NAME = k.TABLE_NAME
    WHERE k.CONSTRAINT_SCHEMA = DATABASE()
      AND k.TABLE_NAME = 'organization_units'
      AND k.COLUMN_NAME = 'created_by'
      AND k.REFERENCED_TABLE_NAME = 'users'
      AND k.REFERENCED_COLUMN_NAME = 'id'
);

SET @sql_created_by := IF(
    @fk_created_by_exists = 0,
    'ALTER TABLE `organization_units` ADD CONSTRAINT `organization_units_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE',
    'DO 0'
);

PREPARE stmt_created_by FROM @sql_created_by;
EXECUTE stmt_created_by;
DEALLOCATE PREPARE stmt_created_by;
