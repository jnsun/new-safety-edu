const api = require('../../utils/api')

const remainingText = (percent) => percent >= 100 ? '已阅读至末尾' : (percent ? `约剩 ${100 - percent}%` : '全部内容待阅读')

Page({
  data: { assignmentId: '', versionId: '', content: null, progressPercent: 0, remainingText: '全部内容待阅读', atEnd: false, htmlOpened: false, loading: true, busy: false, error: '', syncWarning: '' },
  async onLoad(options) {
    this.setData({ assignmentId: options.assignmentId, versionId: options.versionId })
    try {
      const content = await api.request(`/api/assignments/${options.assignmentId}/coursewares/${options.versionId}`)
      const saved = content.type === 'rich_text' && content.resumeState?.blockKey === 'rich-text' ? content.resumeState.progressPercent : 0
      const progressPercent = Number.isInteger(saved) && saved >= 0 && saved <= 100 ? saved : 0
      this._savedPercent = progressPercent
      this._queuedPercent = progressPercent
      this.setData({ content, progressPercent, remainingText: remainingText(progressPercent), atEnd: progressPercent === 100 })
      if (content.type === 'rich_text') wx.nextTick(() => {
        this.checkShortContent()
        if (progressPercent) this.restorePosition(progressPercent)
      })
    } catch (error) {
      this.setData({ error: error.message })
    } finally {
      this.setData({ loading: false })
    }
  },
  restorePosition(percent) {
    const windowHeight = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowHeight
    wx.createSelectorQuery().in(this).select('.reader-content').boundingClientRect((rect) => {
      if (!rect) return
      this._contentTop = rect.top
      wx.pageScrollTo({ scrollTop: Math.max(0, Math.round(rect.top + Math.max(0, rect.height - windowHeight) * percent / 100)), duration: 0 })
    }).exec()
  },
  checkShortContent() {
    const windowHeight = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()).windowHeight
    wx.createSelectorQuery().in(this).select('.finish-panel').boundingClientRect((rect) => {
      if (rect?.bottom <= windowHeight) this.onReachBottom()
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
    this.setData({ progressPercent: 100, remainingText: remainingText(100), atEnd: true })
    this.queueResumeSave(100, true)
  },
  queueResumeSave(progressPercent, immediate = false) {
    clearTimeout(this._saveTimer)
    this._queuedPercent = progressPercent
    if (immediate) return this.persistResume(progressPercent)
    this._saveTimer = setTimeout(() => this.persistResume(progressPercent), 300)
  },
  persistResume(progressPercent) {
    this._saveChain = (this._saveChain || Promise.resolve()).then(async () => {
      try {
        await api.request(`/api/assignments/${this.data.assignmentId}/coursewares/${this.data.versionId}/resume`, 'PATCH', { blockKey: 'rich-text', progressPercent })
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
    this.setData({ htmlOpened: true })
    wx.navigateTo({ url: `/pages/html/index?url=${encodeURIComponent(this.data.content.viewerUrl)}` })
  },
  async complete() {
    if (this.data.content?.type === 'rich_text' && !this.data.atEnd || this.data.content?.type === 'single_html' && !this.data.htmlOpened) return
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
  }
})
