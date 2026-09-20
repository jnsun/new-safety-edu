const api = require('../../utils/api')
const typeNames = { employee: '正式员工', contractor: '外协人员', temporary_individual: '临时个人' }
const maskPhone = (value) => {
  const phone = String(value || '')
  return /^1\d{10}$/.test(phone) ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : '待补录'
}

Page({
  data: { loading: true, error: '', person: null, photoPath: '' },
  onLoad() { return this.load() },
  async load() {
    this.setData({ loading: true, error: '' })
    try {
      const person = await api.request('/api/me/profile')
      this.setData({ person: { ...person, typeText: typeNames[person.type] || person.type, phoneText: maskPhone(person.phone), organizationText: person.organizations.map((item) => item.name).join('、') || '待补录' } })
      if (person.photoFileId) this.setData({ photoPath: await api.download(`/api/files/${person.photoFileId}`) })
    } catch (error) { this.setData({ error: error.message || '个人资料加载失败' }) }
    finally { this.setData({ loading: false }) }
  }
})
