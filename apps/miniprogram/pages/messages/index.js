const api = require('../../utils/api')
const { syncTabBar } = require('../../utils/tab-bar')
const { date } = require('../../utils/format')

const categoryFilters = [
  { value: 'all', label: '全部' },
  { value: 'training', label: '培训提醒' },
  { value: 'approval', label: '审批结果' },
  { value: 'system', label: '系统通知' }
]

function categoryOf(item) {
  const value = `${item.type || ''} ${item.title || ''}`.toLowerCase()
  if (/approve|review|审核|审批|绑定/.test(value)) return 'approval'
  if (/training|exam|course|培训|考试|学习|催办/.test(value)) return 'training'
  return 'system'
}

function filtered(messages, category) {
  return category === 'all' ? messages : messages.filter((item) => item.category === category)
}
Page({
  data: { messages: [], visibleMessages: [], unreadCount: 0, category: 'all', categoryFilters, loading: true, error: '' },
  async onShow() {
    syncTabBar(this, 3)
    this.setData({ loading: true, error: '' })
    try {
      const messages = await api.request('/api/me/notifications')
      const rows = messages.map((item) => ({ ...item, category: categoryOf(item), createdText: date(item.createdAt) }))
      this.setData({ messages: rows, visibleMessages: filtered(rows, this.data.category), unreadCount: rows.filter((item) => item.status === 'unread').length })
    }
    catch (error) { this.setData({ error: error.message || '消息加载失败' }) }
    finally { this.setData({ loading: false }) }
  },
  async read(e) {
    try {
      await api.request(`/api/me/notifications/${e.currentTarget.dataset.id}/read`, 'PATCH')
      await this.onShow()
    } catch (error) { wx.showToast({ title: error.message || '操作失败', icon: 'none' }) }
  },
  chooseCategory(e) { const category = e.currentTarget.dataset.value; this.setData({ category, visibleMessages: filtered(this.data.messages, category) }) }
})
