const api = require('../../utils/api')
const { decorate } = require('../../utils/format')
Page({ data: { record: null, loading: true, error: '' }, async onLoad(options) { try { this.setData({ record: decorate(await api.request(`/api/me/records/${options.id}`)) }) } catch (error) { this.setData({ error: error.message }) } finally { this.setData({ loading: false }) } } })
