const api = require('../../utils/api')
Page({
  data: { assignmentId: '', touched: false, busy: false, error: '' },
  onLoad(options) { this.setData({ assignmentId: options.assignmentId }); this.context = wx.createCanvasContext('signature', this); this.context.setStrokeStyle('#172b4d'); this.context.setLineWidth(4); this.context.setLineCap('round') },
  start(e) { const point = e.touches[0]; this.context.beginPath(); this.context.moveTo(point.x, point.y); this.setData({ touched: true }) },
  move(e) { const point = e.touches[0]; this.context.lineTo(point.x, point.y); this.context.stroke(); this.context.draw(true); this.context.moveTo(point.x, point.y) },
  clear() { this.context.clearRect(0, 0, 1000, 500); this.context.draw(); this.setData({ touched: false, error: '' }) },
  image() { return new Promise((resolve, reject) => wx.canvasToTempFilePath({ canvasId: 'signature', fileType: 'png', success: ({ tempFilePath }) => resolve(tempFilePath), fail: reject }, this)) },
  async preview() { if (!this.data.touched) return; const path = await this.image(); wx.previewImage({ urls: [path] }) },
  async submit() { if (!this.data.touched) return this.setData({ error: '请由本人手写签字' }); this.setData({ busy: true, error: '' }); try { const path = await this.image(); const file = await api.uploadSignature(path); const system = wx.getSystemInfoSync(); await api.request(`/api/assignments/${this.data.assignmentId}/sign`, 'POST', { fileId: file.id, deviceInfo: { model: system.model, platform: system.platform, system: system.system, version: system.version } }); wx.showToast({ title: '签字已提交', icon: 'success' }); setTimeout(() => wx.reLaunch({ url: '/pages/records/index' }), 600) } catch (error) { this.setData({ error: error.message }) } finally { this.setData({ busy: false }) } }
})
