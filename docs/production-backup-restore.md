# 生产数据库备份与恢复

以下命令在服务器 `/opt/safety-training` 执行，环境变量只从权限为 `600` 的 `.env.production` 读取，不在终端打印密码。

## 创建和检查备份

```bash
cd /opt/safety-training
sudo install -d -m 700 backups
set -a; . ./.env.production; set +a
stamp=$(date +%Y%m%d_%H%M%S)
sudo docker compose exec -T -e PGPASSWORD="$APP_DB_PASSWORD" postgres \
  pg_dump -U "$APP_DB_USER" -d "$APP_DB_NAME" -Fc \
  > "backups/safety_training_${stamp}.dump"
chmod 600 "backups/safety_training_${stamp}.dump"
sudo docker compose exec -T postgres pg_restore --list \
  < "backups/safety_training_${stamp}.dump" >/dev/null
ls -lh "backups/safety_training_${stamp}.dump"
```

## 恢复到一个新的空数据库

不要覆盖生产库，不要执行 `docker compose down -v`。先停止 API，再把备份恢复到不同名称的空库：

```bash
cd /opt/safety-training
set -a; . ./.env.production; set +a
backup=backups/safety_training_YYYYMMDD_HHMMSS.dump
restore_db=safety_training_restore_check
sudo docker compose stop api
sudo docker compose exec -T -e PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" postgres \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE ${restore_db} OWNER ${APP_DB_USER};"
sudo docker compose exec -T -e PGPASSWORD="$APP_DB_PASSWORD" postgres \
  pg_restore -U "$APP_DB_USER" -d "$restore_db" --no-owner --no-privileges \
  < "$backup"
sudo docker compose exec -T -e PGPASSWORD="$APP_DB_PASSWORD" postgres \
  psql -U "$APP_DB_USER" -d "$restore_db" -Atc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
sudo docker compose start api
sudo docker compose ps
```

确认恢复库表数和关键记录正确后再制定正式切换方案。删除恢复库属于破坏性操作，需另行确认目标名称。
