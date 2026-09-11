const api = require('../../utils/api')
Page({
  data: { assignmentId: '', versionId: '', content: null, loading: true, busy: false, error: '' },
  async onLoad(options) { this.setData(options); try { const content = await api.request(`/api/assignments/${options.assignmentId}/coursewares/${options.versionId}`); this.setData({ content }) } catch (error) { this.setData({ error: error.message }) } finally { this.setData({ loading: false }) } },
  openHtml() { wx.navigateTo({ url: `/pages/html/index?url=${encodeURIComponent(this.data.content.viewerUrl)}` }) },
  async complete() { this.setData({ busy: true }); try { await api.request(`/api/assignments/${this.data.assignmentId}/learning/${this.data.versionId}/complete`, 'POST'); wx.showToast({ title: '学习已完成', icon: 'success' }); setTimeout(() => wx.navigateBack(), 500) } catch (error) { this.setData({ error: error.message }) } finally { this.setData({ busy: false }) } }
})
