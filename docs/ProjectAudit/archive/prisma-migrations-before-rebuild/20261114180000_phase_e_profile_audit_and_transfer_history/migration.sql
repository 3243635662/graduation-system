-- AlterTable
ALTER TABLE `student_profiles` ADD COLUMN `updated_by` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `teacher_profiles` ADD COLUMN `updated_by` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `student_class_transfers` (
    `id` CHAR(36) NOT NULL,
    `student_profile_id` CHAR(36) NOT NULL,
    `from_class_id` CHAR(36) NOT NULL,
    `to_class_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(255) NULL,
    `transferred_by` CHAR(36) NOT NULL,
    `transferred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_class_transfers_student_profile_id_transferred_at_idx`(`student_profile_id`, `transferred_at`),
    INDEX `student_class_transfers_from_class_id_idx`(`from_class_id`),
    INDEX `student_class_transfers_to_class_id_idx`(`to_class_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `student_profiles_updated_by_idx` ON `student_profiles`(`updated_by`);

-- CreateIndex
CREATE INDEX `teacher_profiles_updated_by_idx` ON `teacher_profiles`(`updated_by`);

-- AddForeignKey
ALTER TABLE `student_profiles` ADD CONSTRAINT `student_profiles_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_profiles` ADD CONSTRAINT `teacher_profiles_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_class_transfers` ADD CONSTRAINT `student_class_transfers_student_profile_id_fkey` FOREIGN KEY (`student_profile_id`) REFERENCES `student_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_class_transfers` ADD CONSTRAINT `student_class_transfers_from_class_id_fkey` FOREIGN KEY (`from_class_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_class_transfers` ADD CONSTRAINT `student_class_transfers_to_class_id_fkey` FOREIGN KEY (`to_class_id`) REFERENCES `organization_units`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_class_transfers` ADD CONSTRAINT `student_class_transfers_transferred_by_fkey` FOREIGN KEY (`transferred_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
