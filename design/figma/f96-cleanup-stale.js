//!include ./_kit.js
// 一次性清理：删除早期命名的、无序号前缀的小程序画板（改名前的遗留）
const stale = ['▣ 待办', '▣ 任务详情', '▣ 课件学习', '▣ 在线考试', '▣ 学习记录', '▣ 安全闯关', '▣ 我的', '▣ 登录'];
const removed = clearBoards(stale);
return { 已删除: removed };
