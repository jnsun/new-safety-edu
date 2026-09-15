# 生产维护简明说明

以下命令都在部署目录执行，并只读取权限为 `600` 的生产环境文件。先创建并验证 `pg_dump`，再执行任何会修改数据的维护命令。

## 身份约束迁移预检

在测试或生产执行新身份约束 migration 前先运行 `pnpm identity:preflight`。任何项目非零或结果为 `IDENTITY_PREFLIGHT=BLOCKED` 时停止迁移并人工核对；该命令只读，不输出姓名、手机号或身份证号。

## 数据与文件留存

```bash
sudo docker compose exec api pnpm retention
sudo docker compose exec api pnpm files:cleanup-orphans
sudo docker compose exec api pnpm audit:replay
sudo docker compose exec api pnpm capacity:check
```

前三项默认仅预览。确认预览结果后，生产执行形式为：

```bash
sudo docker compose exec api pnpm retention -- --apply --confirm-production
sudo docker compose exec api pnpm files:cleanup-orphans -- --apply --confirm-production
sudo docker compose exec api pnpm audit:replay -- --apply --confirm-production
```

业务审计日志不在留存清理范围内。孤儿文件先移入隔离目录，数据库删除失败时会恢复原文件。审计补写文件含无效记录时整次拒绝执行，成功补写后原文件改名归档。容量检查只输出数据库字节数、私有文件数量/大小和磁盘占用比例，不输出人员资料。

## 公司管理员应急恢复

仅在服务器本地以 `sudo/root` 执行。临时密码通过一次性环境变量传入，不写命令参数、不写普通日志；执行后立即清除终端环境变量，并要求本人首次登录修改密码。

```bash
read -s ADMIN_RECOVERY_PASSWORD
export ADMIN_RECOVERY_PASSWORD
sudo --preserve-env=ADMIN_RECOVERY_PASSWORD docker compose exec -e ADMIN_RECOVERY_PASSWORD api \
  pnpm admin:recovery -- --username <existing-admin> --confirm-production
unset ADMIN_RECOVERY_PASSWORD
```

系统仍有有效公司管理员时，只允许恢复已有公司管理员；没有有效公司管理员时，才允许为符合条件的在用正式员工恢复公司管理员角色。操作会注销该账号全部会话并写入事务审计。

## 调度建议

使用宿主机现有 `cron` 或 systemd timer 调用上述一次性命令即可：容量检查每日一次，留存预览每周一次，实际清理按管理员审核后的维护窗口执行。不引入独立调度平台。

数据库备份与恢复命令见 `docs/production-backup-restore.md`。
