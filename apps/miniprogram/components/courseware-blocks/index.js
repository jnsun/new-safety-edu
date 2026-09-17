const api = require('../../utils/api')

const knownTypes = new Set(['knowledge', 'do_dont', 'steps', 'checkpoint', 'scenario', 'summary'])
const sameIndexes = (left, right) => left.length === right.length && left.every((value, index) => value === right[index])

Component({
  properties: {
    units: {
      type: Array,
      value: [],
      observer(value) { this.prepareUnits(value) }
    },
    resumeBlockKey: {
      type: String,
      value: '',
      observer() { this.scheduleResumeScroll() }
    }
  },
  data: { preparedUnits: [], totalBlocks: 0 },
  lifetimes: {
    detached() { this._detached = true; this._renderGeneration = (this._renderGeneration || 0) + 1 }
  },
  methods: {
    prepareUnits(units) {
      const source = Array.isArray(units) ? units : []
      const totalBlocks = source.reduce((total, unit) => total + (Array.isArray(unit.blocks) ? unit.blocks.length : 0), 0)
      let globalIndex = 0
      const preparedUnits = source.map((unit) => ({
        ...unit,
        blocks: (Array.isArray(unit.blocks) ? unit.blocks : []).map((block) => {
          const currentIndex = globalIndex++
          const isLast = currentIndex === totalBlocks - 1
          return {
            ...block,
            known: knownTypes.has(block.type),
            domId: `courseware-block-${currentIndex}`,
            globalIndex: currentIndex,
            isLast,
            progressPercent: isLast ? 100 : Math.min(99, Math.round((currentIndex + 1) / Math.max(1, totalBlocks) * 100)),
            image: block.type === 'knowledge' && block.imageFileId ? { loading: true, path: '', error: '' } : null,
            options: block.type === 'checkpoint' ? (block.options || []).map((label, index) => ({ label, index, selected: false })) : [],
            hasSelection: false,
            feedback: null,
            scenarioChoices: block.type === 'scenario' ? (block.choices || []).map((choice, index) => ({ ...choice, index, selected: false })) : [],
            scenarioFeedback: null
          }
        })
      }))
      this._renderGeneration = (this._renderGeneration || 0) + 1
      const generation = this._renderGeneration
      this.setData({ preparedUnits, totalBlocks })
      this.downloadImages(generation)
      this.scheduleResumeScroll()
    },
    async downloadImages(generation) {
      for (let unitIndex = 0; unitIndex < this.data.preparedUnits.length; unitIndex += 1) {
        const blocks = this.data.preparedUnits[unitIndex].blocks
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
          const block = blocks[blockIndex]
          if (!block.image || !block.imageFileId) continue
          await this.downloadImage(unitIndex, blockIndex, generation)
        }
      }
    },
    async downloadImage(unitIndex, blockIndex, generation = this._renderGeneration) {
      const block = this.data.preparedUnits[unitIndex]?.blocks[blockIndex]
      if (!block?.imageFileId) return
      this.setData({ [`preparedUnits.${unitIndex}.blocks.${blockIndex}.image`]: { loading: true, path: '', error: '' } })
      try {
        const path = await api.download(`/api/files/${block.imageFileId}`)
        if (!this._detached && generation === this._renderGeneration) this.setData({ [`preparedUnits.${unitIndex}.blocks.${blockIndex}.image`]: { loading: false, path, error: '' } })
      } catch (error) {
        if (!this._detached && generation === this._renderGeneration) this.setData({ [`preparedUnits.${unitIndex}.blocks.${blockIndex}.image`]: { loading: false, path: '', error: error.message || '图片读取失败' } })
      }
    },
    retryImage(event) {
      const { unitIndex, blockIndex } = event.currentTarget.dataset
      this.downloadImage(Number(unitIndex), Number(blockIndex))
    },
    scheduleResumeScroll() {
      const key = this.data.resumeBlockKey
      if (!key || !this.data.preparedUnits.length) return
      const block = this.data.preparedUnits.flatMap((unit) => unit.blocks).find((item) => item.key === key)
      if (!block) return
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.selectViewport().scrollOffset()
        query.select(`#${block.domId}`).boundingClientRect()
        query.exec(([viewport, target]) => {
          if (target) wx.pageScrollTo({ scrollTop: Math.max(0, (viewport?.scrollTop || 0) + target.top - 16), duration: 0 })
        })
      })
    },
    selectCheckpointOption(event) {
      const { unitIndex, blockIndex, optionIndex } = event.currentTarget.dataset
      const unit = Number(unitIndex); const blockNumber = Number(blockIndex); const option = Number(optionIndex)
      const block = this.data.preparedUnits[unit]?.blocks[blockNumber]
      if (!block || block.type !== 'checkpoint') return
      const multiple = block.questionType === 'multiple_choice'
      const options = block.options.map((item) => ({ ...item, selected: multiple ? (item.index === option ? !item.selected : item.selected) : item.index === option }))
      this.setData({
        [`preparedUnits.${unit}.blocks.${blockNumber}.options`]: options,
        [`preparedUnits.${unit}.blocks.${blockNumber}.hasSelection`]: options.some((item) => item.selected),
        [`preparedUnits.${unit}.blocks.${blockNumber}.feedback`]: null
      })
    },
    submitCheckpoint(event) {
      const { unitIndex, blockIndex } = event.currentTarget.dataset
      const unit = Number(unitIndex); const blockNumber = Number(blockIndex)
      const block = this.data.preparedUnits[unit]?.blocks[blockNumber]
      if (!block || block.type !== 'checkpoint') return
      const selectedIndexes = block.options.filter((option) => option.selected).map((option) => option.index).sort((a, b) => a - b)
      if (!selectedIndexes.length) return
      const correctIndexes = [...block.correctIndexes].sort((a, b) => a - b)
      const correct = sameIndexes(selectedIndexes, correctIndexes)
      const feedback = { correct, text: correct ? '回答正确' : '回答不正确', explanation: block.explanation }
      this.setData({ [`preparedUnits.${unit}.blocks.${blockNumber}.feedback`]: feedback })
      this.triggerEvent('checkpoint-answered', { blockKey: block.key, correct, selectedIndexes })
    },
    selectScenarioChoice(event) {
      const { unitIndex, blockIndex, choiceIndex } = event.currentTarget.dataset
      const unit = Number(unitIndex); const blockNumber = Number(blockIndex); const choice = Number(choiceIndex)
      const block = this.data.preparedUnits[unit]?.blocks[blockNumber]
      if (!block || block.type !== 'scenario' || !block.scenarioChoices[choice]) return
      this.setData({
        [`preparedUnits.${unit}.blocks.${blockNumber}.scenarioChoices`]: block.scenarioChoices.map((item) => ({ ...item, selected: item.index === choice })),
        [`preparedUnits.${unit}.blocks.${blockNumber}.scenarioFeedback`]: block.scenarioChoices[choice]
      })
    },
    confirmBlockReached(event) {
      const { unitIndex, blockIndex } = event.currentTarget.dataset
      const block = this.data.preparedUnits[Number(unitIndex)]?.blocks[Number(blockIndex)]
      if (!block) return
      this.triggerEvent('block-reached', { blockKey: block.key, progressPercent: block.progressPercent, isLast: block.isLast, confirmed: true })
    }
  }
})
