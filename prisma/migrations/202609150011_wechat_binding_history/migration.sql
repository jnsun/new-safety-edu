DROP INDEX "wechat_bindings_app_id_openid_key";

CREATE UNIQUE INDEX "wechat_bindings_one_active_identity_per_app"
  ON "wechat_bindings"("app_id", "openid") WHERE "active";

CREATE INDEX "wechat_bindings_app_id_openid_active_idx"
  ON "wechat_bindings"("app_id", "openid", "active");

CREATE INDEX "wechat_bindings_unionid_active_idx"
  ON "wechat_bindings"("unionid", "active");
