const items = [
  { pagePath: '/pages/todo/index', text: '待办', icon: 'task-checked' },
  { pagePath: '/pages/records/index', text: '记录', icon: 'book-open' },
  { pagePath: '/pages/games/index', text: '闯关', icon: 'secured' },
  { pagePath: '/pages/messages/index', text: '消息', icon: 'notification' },
  { pagePath: '/pages/profile/index', text: '我的', icon: 'user' }
]

Component({
  data: { items, selected: -1 },
  lifetimes: { attached() { this.syncSelected() } },
  pageLifetimes: { show() { this.syncSelected() } },
  methods: {
    syncSelected() {
      const pages = getCurrentPages()
      const current = pages.length ? `/${pages[pages.length - 1].route}` : ''
      const selected = items.findIndex((item) => item.pagePath === current)
      if (selected >= 0) this.setData({ selected })
    },
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index)
      const item = items[index]
      if (!item) return
      this.setData({ selected: index })
      wx.switchTab({ url: item.pagePath, fail: () => this.syncSelected() })
    }
  }
})
