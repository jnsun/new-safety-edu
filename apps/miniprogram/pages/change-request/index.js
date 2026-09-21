const api = require('../../utils/api')
const types = { profile_change: '姓名修改', binding_change: '微信换绑（旧申请）', department_transfer: '调换部门' }
const statuses = { pending: '待审核', approved: '已通过', rejected: '已驳回', withdrawn: '已撤回', cancelled: '已取消', failed: '处理失败' }
Page({
  data: { type: 'profile_change', requests: [], busy: false },
  onShow() { this.load() },
  chooseType(e) { this.setData({ type: e.detail.value }) },
  async load() { try { const requests = await api.request('/api/me/change-requests'); this.setData({ requests: requests.map((row) => ({ ...row, typeText: types[row.type] || row.type, statusText: statuses[row.status] || row.status, canWithdraw: (row.availableActions || []).includes('withdraw') })) }); } catch (_) {} },
  async submit(e) { this.setData({ busy: true }); try { const values = e.detail.value; await api.request('/api/me/change-requests', 'POST', { type: 'profile_change', name: values.name || undefined, reason: values.reason }); wx.showToast({ title: '已提交审核' }); await this.load(); } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); } finally { this.setData({ busy: false }); } },
  async withdraw(e) { const result = await wx.showModal({ title: '撤回申请', editable: true, placeholderText: '请输入撤回原因' }); if (!result.confirm) return; const reason = String(result.content || '').trim(); if (reason.length < 2) return wx.showToast({ title: '请输入至少2个字', icon: 'none' }); try { await api.request(`/api/me/change-requests/${e.currentTarget.dataset.id}/withdraw`, 'POST', { reason }); wx.showToast({ title: '已撤回' }); await this.load(); } catch (error) { wx.showToast({ title: error.message, icon: 'none' }); } }
})
