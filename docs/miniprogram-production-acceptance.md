# 微信小程序正式环境人工验收清单

## 微信公众平台配置

- [ ] 在“小程序代码管理/开发设置”确认正式 AppID，并写入 `apps/miniprogram/project.config.json`。
- [ ] request 合法域名：`https://www.safety.sx.cn`
- [ ] uploadFile 合法域名：`https://www.safety.sx.cn`
- [ ] downloadFile 合法域名：`https://www.safety.sx.cn`
- [ ] 业务域名：`https://www.safety.sx.cn`（HTML 课件 `web-view`）
- [ ] 在服务器 `/opt/safety-training/.env.production` 配置 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`，文件权限保持 `600`，然后仅重建 API 容器。
- [ ] 如已审核订阅消息模板，配置 `WECHAT_SUBSCRIBE_TEMPLATE_TASK`、`WECHAT_SUBSCRIBE_TEMPLATE_DUE` 及对应字段名；未配置不阻塞其他功能。
- [ ] 在微信公众平台完成用户隐私保护指引、手机号能力及体验成员配置。

合法域名只填写 HTTPS 域名，不填写 `/api` 路径。AppSecret 不得写入小程序项目、Git、Admin 或构建产物。

## 微信开发者工具

- [ ] 使用正式 AppID 导入 `apps/miniprogram`，保持“不校验合法域名”关闭。
- [ ] 编译无错误，确认请求基址为 `https://www.safety.sx.cn/api`。
- [ ] 预览二维码和体验版均不再访问 IP、HTTP 或 Mock 登录。

## 真机主流程

- [ ] 1. `wx.login` 登录成功，已登记手机号唯一匹配后完成绑定。
- [ ] 2. 未匹配或重复手机号进入人工审核，不能由客户端指定人员档案。
- [ ] 3. “我的待办”只显示本人必须完成的任务。
- [ ] 4. 图文课件打开并完成学习。
- [ ] 5. HTML 课件通过 `https://www.safety.sx.cn/api/courseware-viewer` 打开，过期或无权限链接被拒绝。
- [ ] 6. 全部课件完成后进入考试并正常提交评分。
- [ ] 7. 退出后恢复同一考试和已保存答案。
- [ ] 8. 不及格后完成补学才能重考。
- [ ] 9. 次数耗尽后锁定，管理员解锁后可继续。
- [ ] 10. 本人 Canvas 手写签字可清空重写，正式提交后不能覆盖。
- [ ] 11. “我的记录”显示本人培训、成绩和签字状态，不能查看他人记录。
- [ ] 12. 有管理角色时显示“培训管理”，普通人员不显示且 API 拒绝越权。
- [ ] 13. 管理入口可完成申请审核、催办、考试解锁和项目确认。
- [ ] 14. 消息中心显示培训任务、临期、逾期和管理员催办提醒。
- [ ] 15. 配置模板并授权后，订阅消息可送达；未授权或发送失败时系统内消息仍保留。

## 上传体验版

- [ ] 上述平台配置完成且真机登录成功后，上传版本 `0.1.0`。
- [ ] 上传说明：`安全培训学习、考试、签字、项目管理与核心报表首个试用版本。`
