const api = require('../../utils/api')
const { date, decorate } = require('../../utils/format')
const MIN_SIGNATURE_DISTANCE = 24

function signatureSummary(task) {
  const completionTimes = task.coursewares.map((item) => item.completedAt).filter(Boolean).sort()
  const completed = completionTimes[completionTimes.length - 1]
  const attempt = task.latestAttempt
  return {
    learningCompletedText: completed ? date(completed) : (task.coursewares.length ? '尚未完成' : '本次无在线课件'),
    examResultText: !task.batch.examRequired ? '本次不要求考试' : attempt?.passed ? `${attempt.score} 分 · 已通过` : '尚未通过',
    signedAtText: task.signedAt ? date(task.signedAt) : '',
    canSign: task.status === 'pending_signature' && !task.signedAt
  }
}

Page({
  data: {
    assignmentId: '', record: null, learningCompletedText: '', examResultText: '', signedAtText: '',
    canSign: false, touched: false, previewed: false, loading: true, busy: false, error: ''
  },

  onLoad(options) {
    this.setData({ assignmentId: options.assignmentId || '' })
    this.load()
  },

  async load() {
    this.setData({ loading: true, error: '' })
    try {
      await getApp().globalData.ready
      const record = decorate(await api.request(`/api/me/assignments/${this.data.assignmentId}`))
      const summary = signatureSummary(record)
      this.setData({ record, ...summary, touched: false, previewed: false, loading: false }, () => {
        if (summary.canSign) this.initializeCanvas()
      })
    } catch (error) {
      this.setData({ error: error.message, loading: false })
    }
  },

  initializeCanvas() {
    this.strokeDistance = 0
    this.lastPoint = null
    this.context = wx.createCanvasContext('signature', this)
    this.context.setStrokeStyle('#172b4d')
    this.context.setLineWidth(4)
    this.context.setLineCap('round')
  },

  start(e) {
    if (!this.context || this.data.busy) return
    const point = e.touches[0]
    this.context.beginPath()
    this.context.moveTo(point.x, point.y)
    this.lastPoint = { x: point.x, y: point.y }
  },

  move(e) {
    if (!this.context || !this.lastPoint || this.data.busy) return
    const point = e.touches[0]
    const distance = Math.hypot(point.x - this.lastPoint.x, point.y - this.lastPoint.y)
    this.context.lineTo(point.x, point.y)
    this.context.stroke()
    this.context.draw(true)
    this.context.moveTo(point.x, point.y)
    this.lastPoint = { x: point.x, y: point.y }
    if (distance > 0) {
      this.strokeDistance += distance
      const touched = this.strokeDistance >= MIN_SIGNATURE_DISTANCE
      if (touched !== this.data.touched || this.data.previewed || this.data.error) {
        this.setData({ touched, previewed: false, error: '' })
      }
    }
  },

  end() { this.lastPoint = null },

  clear() {
    if (!this.context || !this.data.canSign || this.data.busy) return
    this.context.clearRect(0, 0, 1000, 500)
    this.context.draw()
    this.strokeDistance = 0
    this.lastPoint = null
    this.setData({ touched: false, previewed: false, error: '' })
  },

  image() {
    return new Promise((resolve, reject) => wx.canvasToTempFilePath({
      canvasId: 'signature', fileType: 'png',
      success: ({ tempFilePath }) => resolve(tempFilePath), fail: reject
    }, this))
  },

  async preview() {
    if (!this.data.touched) return this.setData({ error: '请先由本人手写签字' })
    try {
      const path = await this.image()
      await new Promise((resolve, reject) => wx.previewImage({ urls: [path], success: resolve, fail: reject }))
      this.setData({ previewed: true, error: '' })
    } catch (error) {
      this.setData({ error: error.message || '签字预览失败，请重试' })
    }
  },

  back() { wx.navigateBack() },

  async submit() {
    if (this.data.busy) return
    if (!this.data.touched) return this.setData({ error: '请由本人手写签字' })
    if (!this.data.previewed) return this.setData({ error: '请先预览签字，确认无误后再提交' })
    const confirmed = await new Promise((resolve) => wx.showModal({
      title: '确认正式提交',
      content: '正式签字提交后本人不能覆盖或重签，请确认培训记录和签字均无误。',
      confirmText: '正式提交',
      success: ({ confirm }) => resolve(confirm),
      fail: () => resolve(false)
    }))
    if (!confirmed) return

    this.setData({ busy: true, error: '' })
    try {
      const path = await this.image()
      const file = await api.uploadSignature(path)
      const system = wx.getSystemInfoSync()
      await api.request(`/api/assignments/${this.data.assignmentId}/sign`, 'POST', {
        fileId: file.id,
        deviceInfo: { model: system.model, platform: system.platform, system: system.system, version: system.version }
      })
      await this.load()
      wx.showToast({ title: '签字已提交', icon: 'success' })
    } catch (error) {
      if (error.statusCode === 409) {
        await this.load()
        if (this.data.signedAtText) return wx.showToast({ title: '签字已提交', icon: 'success' })
      }
      this.setData({ error: error.message })
    } finally {
      this.setData({ busy: false })
    }
  }
})
