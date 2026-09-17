const api = require('../../utils/api')
const examPositionKey = (attemptId) => `exam-position:${attemptId}`
const activeAttemptKey = (assignmentId) => `exam-active-attempt:${assignmentId}`
const finalizedAttemptErrors = new Set(['INVALID_ASSIGNMENT_STATE', 'EXAM_NOT_REQUIRED', 'ATTEMPT_CLOSED', 'ATTEMPT_EXPIRED'])

function questionTypeText(type) {
  if (type === 'multiple_choice') return '多选题'
  if (type === 'true_false') return '判断题'
  return '单选题'
}

function examViewState(questions, answers, currentIndex) {
  const answeredCount = questions.filter((question) => Array.isArray(answers[question.id]) && answers[question.id].length).length
  const question = questions[currentIndex] || null
  const selected = question && Array.isArray(answers[question.id]) ? answers[question.id].map(String) : []
  const currentQuestion = question ? {
    ...question,
    typeText: questionTypeText(question.type),
    options: question.options.map((label) => ({ label, checked: selected.includes(label) }))
  } : null
  return {
    currentQuestion,
    answeredCount,
    answeredPercent: questions.length ? Math.round(answeredCount / questions.length * 100) : 0,
    canGoPrevious: currentIndex > 0,
    canGoNext: currentIndex < questions.length - 1,
    nextLabel: currentIndex < questions.length - 1 ? '下一题' : '检查答题',
    reviewItems: questions.map((item, index) => ({ index, number: index + 1, answered: Array.isArray(answers[item.id]) && answers[item.id].length }))
  }
}

Page({
  data: {
    assignmentId: '', attempt: null, questions: [], answers: {}, currentIndex: 0, currentQuestion: null,
    answeredCount: 0, answeredPercent: 0, canGoPrevious: false, canGoNext: false, nextLabel: '下一题',
    reviewItems: [], reviewing: false, remaining: '--:--', expired: false, loading: true, busy: false,
    saveState: 'idle', saveStateText: '答案会自动保存', error: ''
  },

  onLoad(options) {
    this.setData({ assignmentId: options.assignmentId })
    this.loadAttempt()
  },

  async loadAttempt() {
    clearInterval(this.timer)
    clearTimeout(this.saveTimer)
    this.examFinalized = false
    this.setData({ loading: true, error: '', expired: false })
    try {
      const attempt = await api.request(`/api/assignments/${this.data.assignmentId}/attempts/start`, 'POST')
      const answers = {}
      ;(attempt.answers || []).forEach((item) => { answers[item.questionId] = Array.isArray(item.answer) ? item.answer.map(String) : [] })
      const questions = (attempt.questions || []).map((question) => ({
        id: question.id,
        type: question.type,
        prompt: question.prompt,
        options: Array.isArray(question.options) ? question.options.map(String) : []
      }))
      const firstUnanswered = questions.findIndex((question) => !answers[question.id]?.length)
      const fallbackIndex = firstUnanswered < 0 ? 0 : firstUnanswered
      const position = this.restoreExamPosition(attempt.id, questions.length, fallbackIndex)
      const currentIndex = position.currentIndex
      this.answerRevision = 0
      this.savedRevision = 0
      this.setData({
        attempt, questions, answers, currentIndex, reviewing: position.reviewing,
        saveState: Object.keys(answers).length ? 'saved' : 'idle',
        saveStateText: Object.keys(answers).length ? '已恢复并保存' : '答案会自动保存',
        ...examViewState(questions, answers, currentIndex)
      })
      this.persistExamPosition(currentIndex, position.reviewing)
      if (questions.length) this.startTimer()
    } catch (error) {
      if (finalizedAttemptErrors.has(error.code)) {
        this.examFinalized = true
        this.clearExamPosition()
      }
      this.setData({ error: error.message })
    } finally {
      this.setData({ loading: false })
    }
  },

  startTimer() {
    clearInterval(this.timer)
    const tick = () => {
      const seconds = Math.max(0, Math.floor((new Date(this.data.attempt.expiresAt).getTime() - Date.now()) / 1000))
      this.setData({
        remaining: `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
        expired: seconds === 0
      })
      if (!seconds) {
        clearInterval(this.timer)
        this.examFinalized = true
        this.clearExamPosition()
        this.setData({ error: '考试时间已到，请返回任务页查看最新状态。' })
      }
    }
    tick()
    if (!this.data.expired) this.timer = setInterval(tick, 1000)
  },

  chooseOne(e) { this.changeAnswer(e.currentTarget.dataset.id, [e.detail.value]) },
  chooseMany(e) {
    if (e.detail.value.length) return this.changeAnswer(e.currentTarget.dataset.id, e.detail.value)
    this.setData(examViewState(this.data.questions, this.data.answers, this.data.currentIndex))
    wx.showToast({ title: '多选题至少选择一个答案', icon: 'none' })
  },

  changeAnswer(id, answer) {
    if (this.data.expired) return
    const answers = { ...this.data.answers, [id]: answer.map(String) }
    this.answerRevision = (this.answerRevision || 0) + 1
    this.setData({
      answers,
      saveState: 'saving',
      saveStateText: '保存中…',
      error: '',
      ...examViewState(this.data.questions, answers, this.data.currentIndex)
    })
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.flushSave(), 500)
  },

  answerList() {
    return Object.keys(this.data.answers)
      .filter((questionId) => this.data.answers[questionId]?.length)
      .map((questionId) => ({ questionId, answer: this.data.answers[questionId] }))
  },

  async flushSave() {
    clearTimeout(this.saveTimer)
    if (!this.data.attempt || this.savedRevision === this.answerRevision) return true
    if (this.saveInFlight) {
      const activeSave = this.saveInFlight
      const saved = await activeSave
      if (this.saveInFlight === activeSave) this.saveInFlight = null
      if (!saved) return false
      return this.savedRevision === this.answerRevision ? true : this.flushSave()
    }

    const revision = this.answerRevision
    const saveTask = (async () => {
      try {
        await api.request(`/api/attempts/${this.data.attempt.id}/answers`, 'PUT', { answers: this.answerList() })
        this.savedRevision = revision
        if (revision === this.answerRevision) this.setData({ saveState: 'saved', saveStateText: '已保存' })
        return true
      } catch (error) {
        this.setData({ saveState: 'error', saveStateText: '保存失败，请重试', error: `自动保存失败：${error.message}` })
        return false
      }
    })()
    this.saveInFlight = saveTask
    try {
      if (!await saveTask) return false
    } finally {
      if (this.saveInFlight === saveTask) this.saveInFlight = null
    }
    return revision === this.answerRevision ? true : this.flushSave()
  },

  retrySave() {
    this.setData({ saveState: 'saving', saveStateText: '保存中…', error: '' })
    return this.flushSave()
  },

  showQuestion(index) {
    if (index < 0 || index >= this.data.questions.length) return
    this.setData({ currentIndex: index, reviewing: false, ...examViewState(this.data.questions, this.data.answers, index) })
    this.persistExamPosition(index, false)
  },
  previous() { this.showQuestion(this.data.currentIndex - 1) },
  next() {
    if (this.data.canGoNext) return this.showQuestion(this.data.currentIndex + 1)
    this.setData({ reviewing: true })
    this.persistExamPosition(this.data.currentIndex, true)
  },
  openQuestion(e) { this.showQuestion(Number(e.currentTarget.dataset.index)) },
  continueAnswering() {
    const unanswered = this.data.reviewItems.find((item) => !item.answered)
    this.showQuestion(unanswered ? unanswered.index : this.data.currentIndex)
  },

  async submit() {
    if (this.data.busy || this.data.expired) return
    const unanswered = this.data.questions.length - this.data.answeredCount
    const modal = await new Promise((resolve) => wx.showModal({
      title: '确认交卷',
      content: unanswered ? `还有 ${unanswered} 题未作答，仍要提交吗？提交后不能修改。` : '所有题目均已作答，提交后不能修改。',
      confirmText: '确认交卷',
      success: resolve,
      fail: () => resolve({ confirm: false })
    }))
    if (!modal.confirm) return

    this.setData({ busy: true, error: '' })
    try {
      if (!await this.flushSave()) throw new Error('答案尚未保存，请重试后再交卷')
      const result = await api.request(`/api/attempts/${this.data.attempt.id}/submit`, 'POST')
      clearInterval(this.timer)
      this.examFinalized = true
      this.clearExamPosition()
      await new Promise((resolve) => wx.showModal({
        title: result.passed ? '考试通过' : '考试未通过',
        content: `本次成绩 ${result.score} 分${result.assignmentStatus === 'locked' ? '，考试次数已用完，任务已锁定。' : result.passed ? '，请继续完成本人签字。' : '，请重新完成全部课件补学。'}`,
        showCancel: false,
        success: resolve,
        fail: resolve
      }))
      wx.navigateBack()
    } catch (error) {
      if (finalizedAttemptErrors.has(error.code)) {
        this.examFinalized = true
        this.clearExamPosition()
      }
      this.setData({ error: error.message })
    } finally {
      this.setData({ busy: false })
    }
  },

  onUnload() {
    clearInterval(this.timer)
    clearTimeout(this.saveTimer)
    this.persistExamPosition(this.data.currentIndex, this.data.reviewing)
    this.flushSave()
  },
  onHide() {
    this.persistExamPosition(this.data.currentIndex, this.data.reviewing)
    return this.flushSave()
  },

  restoreExamPosition(attemptId, questionCount, fallbackIndex) {
    try {
      const pointerKey = activeAttemptKey(this.data.assignmentId)
      const previousAttemptId = wx.getStorageSync(pointerKey)
      if (previousAttemptId && previousAttemptId !== attemptId) {
        wx.removeStorageSync(examPositionKey(previousAttemptId))
        wx.removeStorageSync(examPositionKey(attemptId))
      }
      wx.setStorageSync(pointerKey, attemptId)
      const stored = wx.getStorageSync(examPositionKey(attemptId))
      if (!questionCount || !stored || stored.attemptId !== attemptId) return { currentIndex: fallbackIndex, reviewing: false }
      const storedIndex = Number(stored.currentIndex)
      const currentIndex = Number.isInteger(storedIndex) ? Math.min(Math.max(storedIndex, 0), questionCount - 1) : fallbackIndex
      return { currentIndex, reviewing: Boolean(stored.reviewing) }
    } catch {
      return { currentIndex: fallbackIndex, reviewing: false }
    }
  },

  persistExamPosition(currentIndex, reviewing) {
    if (this.examFinalized || !this.data.attempt?.id) return
    try {
      wx.setStorageSync(activeAttemptKey(this.data.assignmentId), this.data.attempt.id)
      wx.setStorageSync(examPositionKey(this.data.attempt.id), { attemptId: this.data.attempt.id, currentIndex, reviewing: Boolean(reviewing) })
    } catch {}
  },

  clearExamPosition() {
    try {
      const pointerKey = activeAttemptKey(this.data.assignmentId)
      const storedAttemptId = wx.getStorageSync(pointerKey)
      if (storedAttemptId) wx.removeStorageSync(examPositionKey(storedAttemptId))
      if (this.data.attempt?.id && this.data.attempt.id !== storedAttemptId) wx.removeStorageSync(examPositionKey(this.data.attempt.id))
      wx.removeStorageSync(pointerKey)
    } catch {}
  }
})
