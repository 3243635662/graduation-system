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
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_scope_org_unit_id_fkey` FOREIGN KEY (`scope_org_unit_id`) REFERENCES `organization_units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
