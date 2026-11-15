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

-- AddForeignKey
ALTER TABLE `coordinator_qualification_overrides` ADD CONSTRAINT `coordinator_qualification_overrides_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coordinator_qualification_overrides` ADD CONSTRAINT `coordinator_qualification_overrides_class_id_fkey` FOREIGN KEY (`class_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coordinator_qualification_overrides` ADD CONSTRAINT `coordinator_qualification_overrides_granted_by_fkey` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `coordinator_qualification_overrides` ADD CONSTRAINT `coordinator_qualification_overrides_revoked_by_fkey` FOREIGN KEY (`revoked_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
