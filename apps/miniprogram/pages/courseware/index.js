const api = require('../../utils/api')

const remainingText = (percent) => percent >= 100 ? '已阅读至末尾' : (percent ? `约剩 ${100 - percent}%` : '全部内容待阅读')

Page({
  data: { assignmentId: '', versionId: '', content: null, progressPercent: 0, remainingText: '全部内容待阅读', structuredResumeBlockKey: '', atEnd: false, htmlNavigationSucceeded: false, reachingEnd: false, loading: true, busy: false, error: '', syncWarning: '' },
  async onLoad(options) {
    this._destroyed = false
    this.setData({ assignmentId: options.assignmentId, versionId: options.versionId })
    return this.loadCourseware()
  },
  reloadCourseware() {
    return this.loadCourseware()
  },
  loadCourseware() {
    if (this._loadingRequest) return this._loadingRequest
    const { assignmentId, versionId } = this.data
    if (!assignmentId || !versionId) return Promise.resolve()
    this.setData({ loading: true, error: '' })
    this._loadingRequest = (async () => {
      try {
        const content = await api.request(`/api/assignments/${assignmentId}/coursewares/${versionId}`)
        if (this._destroyed) return
        const hasCompatibleResume = content.type === 'structured' || (content.type === 'rich_text' && content.resumeState?.blockKey === 'rich-text')
        const saved = hasCompatibleResume ? content.resumeState?.progressPercent : 0
        const resumePercent = Number.isInteger(saved) && saved >= 0 && saved <= 100 ? saved : 0
        const atEnd = !!content.reachedEndAt
        const progressPercent = atEnd ? 100 : Math.min(resumePercent, 99)
        this._savedPercent = progressPercent
        this._queuedPercent = progressPercent
        const structuredResumeBlockKey = content.type === 'structured' && typeof content.resumeState?.blockKey === 'string' ? content.resumeState.blockKey : ''
        this.setData({ content, progressPercent, remainingText: remainingText(progressPercent), structuredResumeBlockKey, atEnd })
        if (content.type === 'rich_text' && progressPercent && !atEnd) wx.nextTick(() => this.restorePosition(Math.min(progressPercent, 95)))
      } catch (error) {
        if (!this._destroyed) this.setData({ error: error.message || '课件加载失败，请重试' })
      } finally {
        this._loadingRequest = null
        if (!this._destroyed) this.setData({ loading: false })
      }
    })()
    return this._loadingRequest
  },
  restorePosition(percent) {
    const windowHeight = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowHeight
    wx.createSelectorQuery().in(this).select('.reader-content').boundingClientRect((rect) => {
      if (!rect) return
      this._contentTop = rect.top
      wx.pageScrollTo({ scrollTop: Math.max(0, Math.round(rect.top + Math.max(0, rect.height - windowHeight) * percent / 100)), duration: 0 })
    }).exec()
  },
  onPageScroll({ scrollTop }) {
    if (this.data.content?.type !== 'rich_text' || this.data.atEnd) return
    clearTimeout(this._progressTimer)
    this._progressTimer = setTimeout(() => this.measureProgress(scrollTop), 120)
  },
  measureProgress(scrollTop) {
    const windowHeight = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowHeight
    wx.createSelectorQuery().in(this).select('.reader-content').boundingClientRect((rect) => {
      if (!rect) return
      const contentTop = this._contentTop ?? rect.top + scrollTop
      this._contentTop = contentTop
      const measured = Math.min(99, Math.max(0, Math.round((scrollTop - contentTop) / Math.max(1, rect.height - windowHeight) * 100)))
      const progressPercent = Math.max(this.data.progressPercent, measured)
      if (progressPercent === this.data.progressPercent) return
      this.setData({ progressPercent, remainingText: remainingText(progressPercent) })
      if (progressPercent - (this._queuedPercent ?? 0) >= 10) this.queueResumeSave(progressPercent)
    }).exec()
  },
  onReachBottom() {
    if (this.data.content?.type !== 'rich_text' || this.data.atEnd) return
    this.setData({ progressPercent: 100, remainingText: remainingText(100) })
    this.queueResumeSave(100, true)
    this.recordReachedEnd()
  },
  queueResumeSave(progressPercent, immediate = false, blockKey = 'rich-text') {
    clearTimeout(this._saveTimer)
    this._queuedPercent = progressPercent
    if (immediate) return this.persistResume(progressPercent, blockKey)
    this._saveTimer = setTimeout(() => this.persistResume(progressPercent, blockKey), 300)
  },
  persistResume(progressPercent, blockKey = 'rich-text') {
    this._saveChain = (this._saveChain || Promise.resolve()).then(async () => {
      try {
        await api.request(`/api/assignments/${this.data.assignmentId}/coursewares/${this.data.versionId}/resume`, 'PATCH', { blockKey, progressPercent })
        this._savedPercent = Math.max(this._savedPercent ?? 0, progressPercent)
        if (!this._destroyed) this.setData({ syncWarning: '' })
      } catch (_error) {
        if (this._queuedPercent === progressPercent) this._queuedPercent = this._savedPercent ?? 0
        if (!this._destroyed) this.setData({ syncWarning: '学习位置尚未同步' })
      }
    })
    return this._saveChain
  },
  openHtml() {
    this.setData({ error: '' })
    wx.navigateTo({
      url: `/pages/html/index?url=${encodeURIComponent(this.data.content.viewerUrl)}`,
      success: () => this.setData({ htmlNavigationSucceeded: true }),
      fail: () => this.setData({ htmlNavigationSucceeded: false, error: 'HTML 课件打开失败，请重试' })
    })
  },
  attestHtmlComplete() {
    if (!this.data.htmlNavigationSucceeded) return
    return this.recordReachedEnd()
  },
  attestRichTextComplete() {
    if (this.data.content?.type !== 'rich_text') return
    return this.recordReachedEnd()
  },
  async onStructuredBlockReached({ detail }) {
    if (!detail?.confirmed || !detail.blockKey || !Number.isInteger(detail.progressPercent)) return
    const progressPercent = Math.max(this.data.progressPercent, Math.min(detail.progressPercent, 100))
    this._currentBlockKey = detail.blockKey
    this.setData({ progressPercent, remainingText: remainingText(progressPercent) })
    await this.persistResume(progressPercent, detail.blockKey)
    if (detail.isLast && detail.confirmed) await this.recordReachedEnd()
  },
  recordReachedEnd() {
    if (this.data.atEnd || this._reachedEndPending) return this._reachedEndPending
    this.setData({ reachingEnd: true, error: '' })
    this._reachedEndPending = api.request(`/api/assignments/${this.data.assignmentId}/coursewares/${this.data.versionId}/reached-end`, 'POST')
      .then(({ reachedEndAt }) => {
        if (reachedEndAt && !this._destroyed) this.setData({ atEnd: true, progressPercent: 100, remainingText: remainingText(100) })
      })
      .catch((error) => {
        if (!this._destroyed) this.setData({ error: error.message || '阅读完成状态尚未同步' })
      })
      .finally(() => {
        this._reachedEndPending = null
        if (!this._destroyed) this.setData({ reachingEnd: false })
      })
    return this._reachedEndPending
  },
  async complete() {
    if (!this.data.atEnd) return
    this.setData({ busy: true, error: '' })
    try {
      if (this.data.content.type === 'rich_text') await this.persistResume(100)
      await api.request(`/api/assignments/${this.data.assignmentId}/learning/${this.data.versionId}/complete`, 'POST')
      wx.showToast({ title: '学习已完成', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 500)
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ busy: false })
    }
  },
  onUnload() {
    this._destroyed = true
    clearTimeout(this._progressTimer)
    clearTimeout(this._saveTimer)
    if (this.data.content?.type === 'rich_text' && this.data.progressPercent > (this._savedPercent ?? 0)) this.persistResume(this.data.progressPercent)
    if (this.data.content?.type === 'structured' && this._currentBlockKey && this.data.progressPercent > (this._savedPercent ?? 0)) this.persistResume(this.data.progressPercent, this._currentBlockKey)
  }
})
