const api = require('../../utils/api')
Page({
  data: { assignmentId: '', attempt: null, questions: [], answers: {}, remaining: '--:--', busy: false, error: '' },
  async onLoad(options) { this.setData({ assignmentId: options.assignmentId }); try { const attempt = await api.request(`/api/assignments/${options.assignmentId}/attempts/start`, 'POST'); const answers = {}; (attempt.answers || []).forEach((item) => { answers[item.questionId] = item.answer }); const questions = attempt.questions.map((question) => ({ ...question, options: question.options.map((label) => ({ label, checked: (answers[question.id] || []).includes(label) })) })); this.setData({ attempt, questions, answers }); this.startTimer() } catch (error) { this.setData({ error: error.message }) } },
  startTimer() { const tick = () => { const seconds = Math.max(0, Math.floor((new Date(this.data.attempt.expiresAt).getTime() - Date.now()) / 1000)); this.setData({ remaining: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` }); if (!seconds) clearInterval(this.timer) }; tick(); this.timer = setInterval(tick, 1000) },
  chooseOne(e) { this.changeAnswer(e.currentTarget.dataset.id, [e.detail.value]) },
  chooseMany(e) { this.changeAnswer(e.currentTarget.dataset.id, e.detail.value) },
  changeAnswer(id, answer) { this.setData({ [`answers.${id}`]: answer }); clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.save(), 500) },
  answerList() { return Object.keys(this.data.answers).map((questionId) => ({ questionId, answer: this.data.answers[questionId] })) },
  async save() { if (!this.data.attempt) return; try { await api.request(`/api/attempts/${this.data.attempt.id}/answers`, 'PUT', { answers: this.answerList() }) } catch (error) { this.setData({ error: `自动保存失败：${error.message}` }) } },
  async submit() { this.setData({ busy: true, error: '' }); try { await this.save(); const result = await api.request(`/api/attempts/${this.data.attempt.id}/submit`, 'POST'); clearInterval(this.timer); await new Promise((resolve) => wx.showModal({ title: result.passed ? '考试通过' : '考试未通过', content: `本次成绩 ${result.score} 分${result.assignmentStatus === 'locked' ? '，考试次数已用完，任务已锁定。' : result.passed ? '，请继续完成本人签字。' : '，请重新完成全部课件补学。'}`, showCancel: false, success: resolve })); wx.navigateBack() } catch (error) { this.setData({ error: error.message }) } finally { this.setData({ busy: false }) } },
  onUnload() { clearInterval(this.timer); clearTimeout(this.saveTimer); this.save() }
})
