-- AlterTable
ALTER TABLE `user_roles` ADD COLUMN `revocation_reason` ENUM('MANUAL', 'QUALIFICATION_LOST') NULL;
