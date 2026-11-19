-- 个人中心换绑邮箱：验证当前密码后先解绑原邮箱，再绑定新邮箱。
-- 解绑期间 email 短暂为空，唯一索引在 MariaDB/MySQL 中允许多个 NULL。

ALTER TABLE `users` MODIFY COLUMN `email` VARCHAR(191) NULL;
