const api = require('../../utils/api')

Page({
  data: { loading: true, error: '', attempt: null, currentIndex: 0, current: null, selected: '', selectedMany: [], feedback: null, submitting: false },
  async onShow() { await this.load() },
  async load() {
    this.setData({ loading: true, error: '', feedback: null })
    try {
      await getApp().globalData.ready
      const attempt = await api.request('/api/me/daily-challenge')
      this.setData({ attempt })
      this.showNextUnanswered()
    } catch (error) { this.setData({ error: error.message || '挑战加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  showNextUnanswered() {
    const attempt = this.data.attempt
    if (!attempt) return
    const answered = new Set(attempt.answers.map((item) => item.questionVersionId))
    const index = attempt.questions.findIndex((question) => !answered.has(question.questionVersionId))
    this.setData({ currentIndex: index < 0 ? attempt.questions.length : index, current: index < 0 ? null : attempt.questions[index], selected: '', selectedMany: [], feedback: null })
  },
  chooseSingle(event) { this.setData({ selected: event.detail.value }) },
  chooseMany(event) { this.setData({ selectedMany: event.detail.value }) },
  async submit() {
    const { attempt, current, selected, selectedMany, submitting } = this.data
    if (!attempt || !current || submitting) return
    const answer = current.questionType === 'multiple_choice' || current.type === 'multiple_choice' ? selectedMany : selected
    if (!answer || (Array.isArray(answer) && !answer.length)) return wx.showToast({ title: '请先选择答案', icon: 'none' })
    this.setData({ submitting: true })
    try {
      const result = await api.request('/api/me/daily-challenge/answers', 'POST', { attemptId: attempt.id, questionVersionId: current.questionVersionId, answer })
      const answers = attempt.answers.concat([{ questionVersionId: current.questionVersionId, answer, correct: result.correct, explanation: result.explanation, pointsAwarded: result.originalPointsAwarded }])
      this.setData({ attempt: { ...attempt, answers, answeredCount: answers.length, todayPoints: result.todayPoints }, feedback: result })
    } catch (error) { wx.showToast({ title: error.message || '提交失败', icon: 'none' }) }
    finally { this.setData({ submitting: false }) }
  },
  next() { this.showNextUnanswered() },
  openLeaderboard() { wx.navigateTo({ url: '/pages/leaderboard/index' }) },
  retry() { return this.load() }
})
