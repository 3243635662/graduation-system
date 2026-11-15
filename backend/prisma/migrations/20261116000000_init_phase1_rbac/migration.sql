-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `email_verified_at` DATETIME(3) NULL,
    `phone` VARCHAR(32) NULL,
    `real_name` VARCHAR(50) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `avatar_url` VARCHAR(2048) NULL,
    `status` ENUM('ACTIVE', 'DISABLED', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `last_login_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    UNIQUE INDEX `users_phone_key`(`phone`),
    INDEX `users_status_deleted_at_idx`(`status`, `deleted_at`),
    INDEX `users_real_name_idx`(`real_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NULL,
    `data_scope` ENUM('GLOBAL', 'SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS', 'ASSIGNED', 'SELF') NOT NULL DEFAULT 'SELF',
    `is_system` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,

    UNIQUE INDEX `roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(128) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `module_name` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `description` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `menus` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `title` VARCHAR(100) NOT NULL,
    `path` VARCHAR(255) NULL,
    `component_key` VARCHAR(128) NULL,
    `icon` VARCHAR(100) NULL,
    `type` ENUM('DIRECTORY', 'PAGE') NOT NULL DEFAULT 'PAGE',
    `parent_id` CHAR(36) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `visible` BOOLEAN NOT NULL DEFAULT true,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,

    UNIQUE INDEX `menus_code_key`(`code`),
    UNIQUE INDEX `menus_path_key`(`path`),
    INDEX `menus_parent_id_sort_order_idx`(`parent_id`, `sort_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- CreateTable
CREATE TABLE `user_roles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `scope_org_unit_id` CHAR(36) NULL,
    `scope_key` VARCHAR(80) NOT NULL,
    `assigned_by` CHAR(36) NULL,
    `valid_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `valid_until` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,

    INDEX `user_roles_user_id_idx`(`user_id`),
    INDEX `user_roles_role_id_idx`(`role_id`),
    INDEX `user_roles_scope_org_unit_id_idx`(`scope_org_unit_id`),
    UNIQUE INDEX `uk_user_role_scope`(`user_id`, `role_id`, `scope_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_role_history` (
    `id` CHAR(36) NOT NULL,
    `user_role_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `role_code` VARCHAR(64) NOT NULL,
    `scope_org_unit_id` CHAR(36) NULL,
    `scope_key` VARCHAR(80) NOT NULL,
    `assigned_by` CHAR(36) NULL,
    `valid_from` DATETIME(3) NOT NULL,
    `valid_until` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NOT NULL,
    `revoked_by` CHAR(36) NULL,
    `revocation_reason` ENUM('MANUAL', 'QUALIFICATION_LOST') NOT NULL DEFAULT 'MANUAL',
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_role_history_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    INDEX `user_role_history_role_id_idx`(`role_id`),
    INDEX `user_role_history_user_role_id_idx`(`user_role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `role_id` CHAR(36) NOT NULL,
    `permission_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,

    INDEX `role_permissions_permission_id_idx`(`permission_id`),
    PRIMARY KEY (`role_id`, `permission_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_menus` (
    `role_id` CHAR(36) NOT NULL,
    `menu_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_by` CHAR(36) NULL,

    INDEX `role_menus_menu_id_idx`(`menu_id`),
    PRIMARY KEY (`role_id`, `menu_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `refresh_token_hash` CHAR(64) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `ip_address` VARCHAR(45) NULL,
    `user_agent` VARCHAR(512) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_sessions_refresh_token_hash_key`(`refresh_token_hash`),
    INDEX `auth_sessions_user_id_revoked_at_idx`(`user_id`, `revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_profiles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `student_no` VARCHAR(32) NOT NULL,
    `class_id` CHAR(36) NULL,
    `enrollment_year` INTEGER NULL,
    `enrollment_status` ENUM('ACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `student_profiles_user_id_key`(`user_id`),
    UNIQUE INDEX `student_profiles_student_no_key`(`student_no`),
    INDEX `student_profiles_class_id_enrollment_status_idx`(`class_id`, `enrollment_status`),
    INDEX `student_profiles_enrollment_status_idx`(`enrollment_status`),
    INDEX `student_profiles_updated_by_idx`(`updated_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `personnel_profiles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `employee_no` VARCHAR(32) NULL,
    `primary_organization_unit_id` CHAR(36) NOT NULL,
    `position_name` VARCHAR(64) NULL,
    `status` ENUM('ACTIVE', 'ON_LEAVE', 'LEFT') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `personnel_profiles_user_id_key`(`user_id`),
    UNIQUE INDEX `personnel_profiles_employee_no_key`(`employee_no`),
    INDEX `personnel_profiles_primary_organization_unit_id_status_idx`(`primary_organization_unit_id`, `status`),
    INDEX `personnel_profiles_status_idx`(`status`),
    INDEX `personnel_profiles_updated_by_idx`(`updated_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_profiles` (
    `id` CHAR(36) NOT NULL,
    `personnel_profile_id` CHAR(36) NOT NULL,
    `teacher_no` VARCHAR(32) NOT NULL,
    `title` VARCHAR(64) NULL,
    `professional_info` VARCHAR(500) NULL,
    `status` ENUM('ACTIVE', 'ON_LEAVE', 'LEFT') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,
    `updated_by` CHAR(36) NULL,

    UNIQUE INDEX `teacher_profiles_personnel_profile_id_key`(`personnel_profile_id`),
    UNIQUE INDEX `teacher_profiles_teacher_no_key`(`teacher_no`),
    INDEX `teacher_profiles_status_idx`(`status`),
    INDEX `teacher_profiles_updated_by_idx`(`updated_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_class_duties` (
    `id` CHAR(36) NOT NULL,
    `teacher_id` CHAR(36) NOT NULL,
    `class_id` CHAR(36) NOT NULL,
    `duty_type` ENUM('HEAD_TEACHER') NOT NULL DEFAULT 'HEAD_TEACHER',
    `valid_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `valid_until` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by` CHAR(36) NULL,
    `assigned_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,

    INDEX `teacher_class_duties_class_id_duty_type_valid_until_idx`(`class_id`, `duty_type`, `valid_until`),
    INDEX `teacher_class_duties_teacher_id_valid_until_idx`(`teacher_id`, `valid_until`),
    INDEX `teacher_class_duties_revoked_at_idx`(`revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `counselor_class_assignments` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `class_id` CHAR(36) NOT NULL,
    `valid_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `valid_until` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by` CHAR(36) NULL,
    `assigned_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `created_by` CHAR(36) NULL,

    INDEX `counselor_class_assignments_class_id_valid_until_idx`(`class_id`, `valid_until`),
    INDEX `counselor_class_assignments_user_id_valid_until_idx`(`user_id`, `valid_until`),
    INDEX `counselor_class_assignments_revoked_at_idx`(`revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `coordinator_qualification_overrides` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `class_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(255) NOT NULL,
    `granted_by` CHAR(36) NOT NULL,
    `valid_from` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `valid_until` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `coordinator_qualification_overrides_user_id_class_id_valid_u_idx`(`user_id`, `class_id`, `valid_until`),
    INDEX `coordinator_qualification_overrides_class_id_valid_until_idx`(`class_id`, `valid_until`),
    INDEX `coordinator_qualification_overrides_revoked_at_idx`(`revoked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_class_transfers` (
    `id` CHAR(36) NOT NULL,
    `student_profile_id` CHAR(36) NOT NULL,
    `from_class_id` CHAR(36) NULL,
    `to_class_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `transferred_by` CHAR(36) NOT NULL,
    `transferred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_class_transfers_student_profile_id_transferred_at_idx`(`student_profile_id`, `transferred_at`),
    INDEX `student_class_transfers_from_class_id_idx`(`from_class_id`),
    INDEX `student_class_transfers_to_class_id_idx`(`to_class_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actor_type` ENUM('USER', 'SYSTEM') NOT NULL DEFAULT 'USER',
    `actor_user_id` CHAR(36) NULL,
    `actor_label` VARCHAR(100) NULL,
    `action` VARCHAR(128) NOT NULL,
    `target_type` VARCHAR(64) NOT NULL,
    `target_id` VARCHAR(64) NULL,
    `scope_org_unit_id` CHAR(36) NULL,
    `result` ENUM('SUCCESS', 'FAILURE') NOT NULL DEFAULT 'SUCCESS',
    `source` ENUM('WEB', 'IMPORT', 'SYSTEM') NOT NULL DEFAULT 'WEB',
    `before` JSON NULL,
    `after` JSON NULL,
    `reason` VARCHAR(500) NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    INDEX `audit_logs_target_type_target_id_created_at_idx`(`target_type`, `target_id`, `created_at`),
    INDEX `audit_logs_action_created_at_idx`(`action`, `created_at`),
    INDEX `audit_logs_request_id_idx`(`request_id`),
    INDEX `audit_logs_scope_org_unit_id_created_at_idx`(`scope_org_unit_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `roles` ADD CONSTRAINT `roles_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `permissions` ADD CONSTRAINT `permissions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `menus` ADD CONSTRAINT `menus_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `menus`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `menus` ADD CONSTRAINT `menus_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_units` ADD CONSTRAINT `organization_units_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_units` ADD CONSTRAINT `organization_units_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_scope_org_unit_id_fkey` FOREIGN KEY (`scope_org_unit_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_role_history` ADD CONSTRAINT `user_role_history_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_role_history` ADD CONSTRAINT `user_role_history_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_role_history` ADD CONSTRAINT `user_role_history_scope_org_unit_id_fkey` FOREIGN KEY (`scope_org_unit_id`) REFERENCES `organization_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_role_history` ADD CONSTRAINT `user_role_history_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_fkey` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_menus` ADD CONSTRAINT `role_menus_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_menus` ADD CONSTRAINT `role_menus_menu_id_fkey` FOREIGN KEY (`menu_id`) REFERENCES `menus`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_menus` ADD CONSTRAINT `role_menus_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_profiles` ADD CONSTRAINT `student_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_profiles` ADD CONSTRAINT `student_profiles_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_profiles` ADD CONSTRAINT `student_profiles_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_profiles` ADD CONSTRAINT `student_profiles_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `personnel_profiles` ADD CONSTRAINT `personnel_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `personnel_profiles` ADD CONSTRAINT `personnel_profiles_primary_organization_unit_id_fkey` FOREIGN KEY (`primary_organization_unit_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `personnel_profiles` ADD CONSTRAINT `personnel_profiles_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `personnel_profiles` ADD CONSTRAINT `personnel_profiles_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_profiles` ADD CONSTRAINT `teacher_profiles_personnel_profile_id_fkey` FOREIGN KEY (`personnel_profile_id`) REFERENCES `personnel_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_profiles` ADD CONSTRAINT `teacher_profiles_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_profiles` ADD CONSTRAINT `teacher_profiles_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_class_duties` ADD CONSTRAINT `teacher_class_duties_teacher_id_fkey` FOREIGN KEY (`teacher_id`) REFERENCES `teacher_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_class_duties` ADD CONSTRAINT `teacher_class_duties_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_class_duties` ADD CONSTRAINT `teacher_class_duties_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_class_duties` ADD CONSTRAINT `teacher_class_duties_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_class_duties` ADD CONSTRAINT `teacher_class_duties_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counselor_class_assignments` ADD CONSTRAINT `counselor_class_assignments_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counselor_class_assignments` ADD CONSTRAINT `counselor_class_assignments_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counselor_class_assignments` ADD CONSTRAINT `counselor_class_assignments_assigned_by_fkey` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counselor_class_assignments` ADD CONSTRAINT `counselor_class_assignments_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `counselor_class_assignments` ADD CONSTRAINT `counselor_class_assignments_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coordinator_qualification_overrides` ADD CONSTRAINT `coordinator_qualification_overrides_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coordinator_qualification_overrides` ADD CONSTRAINT `coordinator_qualification_overrides_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coordinator_qualification_overrides` ADD CONSTRAINT `coordinator_qualification_overrides_granted_by_fkey` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coordinator_qualification_overrides` ADD CONSTRAINT `coordinator_qualification_overrides_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_class_transfers` ADD CONSTRAINT `student_class_transfers_student_profile_id_fkey` FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_class_transfers` ADD CONSTRAINT `student_class_transfers_from_class_id_fkey` FOREIGN KEY (`from_class_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_class_transfers` ADD CONSTRAINT `student_class_transfers_to_class_id_fkey` FOREIGN KEY (`to_class_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_class_transfers` ADD CONSTRAINT `student_class_transfers_transferred_by_fkey` FOREIGN KEY (`transferred_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_scope_org_unit_id_fkey` FOREIGN KEY (`scope_org_unit_id`) REFERENCES `organization_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

