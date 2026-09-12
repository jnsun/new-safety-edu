const { getApiBaseUrl } = require('../../config/env')

Page({
  data: { url: '', error: '' },
  onLoad(options) {
    try {
      const url = decodeURIComponent(options.url || '')
      const prefix = `${getApiBaseUrl()}/courseware-viewer?token=`
      this.setData(url.startsWith(prefix) ? { url } : { error: '课件链接无效' })
    } catch (_) { this.setData({ error: '课件链接无效' }) }
  }
})
