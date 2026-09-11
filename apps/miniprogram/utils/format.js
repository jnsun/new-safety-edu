const trainingTypes = { three_level: '三级安全教育', project_induction: '项目入场教育', routine: '日常/年度培训', change_update: '变化内容补充培训' }
const statuses = { pending_learning: '待学习', learning: '学习中', pending_exam: '待考试', remediation_required: '需补学', locked: '已锁定', pending_signature: '待本人签字', confirmation_pending: '待项目确认', completed: '已完成', cancelled: '已取消' }
const date = (value) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-') : '未设置'
const decorate = (task) => ({ ...task, typeText: trainingTypes[task.batch.type] || task.batch.type, statusText: statuses[task.status] || task.status, dueText: date(task.batch.dueAt), completedText: date(task.completedAt), percent: task.progress.total ? Math.round(task.progress.completed / task.progress.total * 100) : 0 })
module.exports = { trainingTypes, statuses, date, decorate }
