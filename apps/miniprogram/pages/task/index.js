const api = require('../../utils/api')
const { decorate } = require('../../utils/format')
Page({
  data: { id: '', task: null, loading: true, error: '' },
  onLoad(options) { this.setData({ id: options.id }) },
  async onShow() { if (!this.data.id) return; try { const task = decorate(await api.request(`/api/me/assignments/${this.data.id}`)); this.setData({ task, error: '' }) } catch (error) { this.setData({ error: error.message }) } finally { this.setData({ loading: false }) } },
  study(e) { const item = e.currentTarget.dataset; wx.navigateTo({ url: `/pages/courseware/index?assignmentId=${this.data.id}&versionId=${item.versionId}` }) },
  exam() { wx.navigateTo({ url: `/pages/exam/index?assignmentId=${this.data.id}` }) },
  sign() { wx.navigateTo({ url: `/pages/signature/index?assignmentId=${this.data.id}` }) }
})
