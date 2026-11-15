-- Phase 1：组织架构（OrganizationUnit）+ 用户角色分配组织范围/有效期/撤销历史
--
-- 安全说明：
-- 1. 不删除 users / auth_sessions / roles / role_menus / role_permissions。
-- 2. user_roles 只有 3 行存量数据，主键从 (user_id, role_id) 切换为独立 id，
--    必须先以可空列加入、回填 UUID 后再收紧为 NOT NULL，否则存量行无法迁移。
-- 3. 存量分配记录的有效期起点沿用原 created_at，撤销字段保持 NULL。
-- 4. 组织编码全局唯一（单学校系统），组织名称允许重复。

-- AlterTable
ALTER TABLE `roles` ADD COLUMN `data_scope` ENUM('GLOBAL', 'SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS', 'ASSIGNED', 'SELF') NOT NULL DEFAULT 'SELF';

-- CreateTable
CREATE TABLE `organization_units` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `type` ENUM('SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS') NOT NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `parent_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,

    UNIQUE INDEX `organization_units_code_key`(`code`),
    INDEX `organization_units_parent_id_sort_order_idx`(`parent_id`, `sort_order`),
    INDEX `organization_units_type_status_idx`(`type`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable：先以可空列加入 user_roles，避免存量行因缺少默认值而迁移失败
ALTER TABLE `user_roles`
    ADD COLUMN `id` CHAR(36) NULL,
    ADD COLUMN `scope_org_unit_id` CHAR(36) NULL,
    ADD COLUMN `assigned_by` CHAR(36) NULL,
    ADD COLUMN `valid_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `valid_until` DATETIME(3) NULL,
    ADD COLUMN `revoked_at` DATETIME(3) NULL,
    ADD COLUMN `revoked_by` CHAR(36) NULL,
    ADD COLUMN `updated_at` DATETIME(3) NULL;

-- 回填存量角色分配：生成独立 id，并把有效期起点对齐原创建时间
UPDATE `user_roles`
SET `id` = UUID(),
    `updated_at` = `created_at`,
    `valid_from` = `created_at`
WHERE `id` IS NULL;

-- 先补建以 user_id 打头的索引：
-- 原主键 (user_id, role_id) 同时承担 user_roles_user_id_fkey 的索引职责，
-- 没有替代索引时 MySQL 会拒绝 DROP PRIMARY KEY（errno 1553）。
CREATE INDEX `user_roles_user_id_role_id_scope_org_unit_id_idx` ON `user_roles`(`user_id`, `role_id`, `scope_org_unit_id`);

-- 收紧约束并切换主键：原主键无法表达同一角色在不同组织范围的多次分配
ALTER TABLE `user_roles`
    MODIFY `id` CHAR(36) NOT NULL,
    MODIFY `updated_at` DATETIME(3) NOT NULL,
    DROP PRIMARY KEY,
    ADD PRIMARY KEY (`id`);

-- CreateIndex
CREATE INDEX `user_roles_user_id_revoked_at_idx` ON `user_roles`(`user_id`, `revoked_at`);

-- CreateIndex
CREATE INDEX `user_roles_scope_org_unit_id_idx` ON `user_roles`(`scope_org_unit_id`);

-- AddForeignKey
ALTER TABLE `organization_units` ADD CONSTRAINT `organization_units_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_units` ADD CONSTRAINT `organization_units_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_scope_org_unit_id_fkey` FOREIGN KEY (`scope_org_unit_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
