const api = require('../../utils/api')

const knownTypes = new Set(['knowledge', 'do_dont', 'steps', 'checkpoint', 'scenario', 'summary'])
const sameIndexes = (left, right) => left.length === right.length && left.every((value, index) => value === right[index])
const canContinue = (block, completedThrough) => !!block?.known && (
  block.globalIndex <= completedThrough
  || block.type === 'checkpoint' && !!block.feedback
  || block.type === 'scenario' && !!block.scenarioFeedback
  || block.type !== 'checkpoint' && block.type !== 'scenario'
)

Component({
  properties: {
    units: {
      type: Array,
      value: [],
      observer(value) { wx.nextTick(() => this.prepareUnits(value)) }
    },
    resumeBlockKey: {
      type: String,
      value: '',
      observer() { wx.nextTick(() => this.activateResumeBlock()) }
    }
  },
  data: {
    preparedUnits: [], totalBlocks: 0, activeGlobalIndex: 0, completedThrough: -1,
    currentUnit: null, currentBlock: null, currentUnitIndex: 0, currentBlockIndex: 0, canContinue: false
  },
  lifetimes: {
    attached() { this._detached = false },
    detached() { this._detached = true; this._renderGeneration = (this._renderGeneration || 0) + 1 }
  },
  methods: {
    prepareUnits(units) {
      const source = Array.isArray(units) ? units : []
      const signature = JSON.stringify(source.map((unit) => [unit.key, (Array.isArray(unit.blocks) ? unit.blocks : []).map((block) => block.key)]))
      if (signature === this._unitsSignature && this.data.preparedUnits.length) return
      this._unitsSignature = signature
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
      this.setData({
        preparedUnits, totalBlocks, activeGlobalIndex: 0, completedThrough: -1,
        currentUnit: null, currentBlock: null, currentUnitIndex: 0, currentBlockIndex: 0, canContinue: false
      })
      this.activateResumeBlock()
      this.downloadImages(generation)
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
      this.setBlockState(unitIndex, blockIndex, { image: { loading: true, path: '', error: '' } })
      try {
        const path = await api.download(`/api/files/${block.imageFileId}`)
        if (!this._detached && generation === this._renderGeneration) this.setBlockState(unitIndex, blockIndex, { image: { loading: false, path, error: '' } })
      } catch (error) {
        if (!this._detached && generation === this._renderGeneration) this.setBlockState(unitIndex, blockIndex, { image: { loading: false, path: '', error: error.message || '图片读取失败' } })
      }
    },
    retryImage(event) {
      const unitIndex = Number(event?.currentTarget?.dataset?.unitIndex ?? this.data.currentUnitIndex)
      const blockIndex = Number(event?.currentTarget?.dataset?.blockIndex ?? this.data.currentBlockIndex)
      this.downloadImage(unitIndex, blockIndex)
    },
    setBlockState(unitIndex, blockIndex, patch) {
      const block = this.data.preparedUnits[unitIndex]?.blocks[blockIndex]
      if (!block) return null
      const updated = { ...block, ...patch }
      const values = { [`preparedUnits[${unitIndex}].blocks[${blockIndex}]`]: updated }
      if (unitIndex === this.data.currentUnitIndex && blockIndex === this.data.currentBlockIndex) {
        values.currentBlock = updated
        values.canContinue = canContinue(updated, this.data.completedThrough)
      }
      this.setData(values)
      return updated
    },
    scheduleResumeScroll() {
      if (!this.data.preparedUnits.length) return
      wx.nextTick(() => {
        const query = wx.createSelectorQuery().in(this)
        query.selectViewport().scrollOffset()
        query.select('.active-block').boundingClientRect()
        query.exec(([viewport, target]) => {
          if (target) wx.pageScrollTo({ scrollTop: Math.max(0, (viewport?.scrollTop || 0) + target.top - 118), duration: 180 })
        })
      })
    },
    activateResumeBlock() {
      const units = Array.isArray(this.data.preparedUnits) ? this.data.preparedUnits : []
      const blocks = units.reduce((all, unit) => all.concat(Array.isArray(unit.blocks) ? unit.blocks : []), [])
      if (!blocks.length) return
      const savedIndex = this.data.resumeBlockKey ? blocks.findIndex((block) => block.key === this.data.resumeBlockKey) : -1
      this.setData({ completedThrough: savedIndex })
      this.activateBlock(savedIndex < 0 ? 0 : Math.min(savedIndex + 1, blocks.length - 1), false, savedIndex)
    },
    activateBlock(globalIndex, shouldScroll = true, completedThrough = this.data.completedThrough) {
      const boundedIndex = Math.max(0, Math.min(Number(globalIndex) || 0, Math.max(0, this.data.totalBlocks - 1)))
      let currentUnitIndex = -1
      let currentBlockIndex = -1
      for (let unitIndex = 0; unitIndex < this.data.preparedUnits.length; unitIndex += 1) {
        const blockIndex = this.data.preparedUnits[unitIndex].blocks.findIndex((block) => block.globalIndex === boundedIndex)
        if (blockIndex >= 0) { currentUnitIndex = unitIndex; currentBlockIndex = blockIndex; break }
      }
      if (currentUnitIndex < 0) return
      const currentUnit = this.data.preparedUnits[currentUnitIndex]
      const currentBlock = currentUnit.blocks[currentBlockIndex]
      this.setData({
        currentUnit, currentBlock, currentUnitIndex, currentBlockIndex,
        activeGlobalIndex: boundedIndex, canContinue: canContinue(currentBlock, completedThrough)
      })
      this.triggerEvent('position-changed', { position: boundedIndex + 1, total: this.data.totalBlocks, unitTitle: currentUnit.title || '' })
      if (shouldScroll) this.scheduleResumeScroll()
    },
    selectCheckpointOption(event) {
      const { optionIndex } = event.currentTarget.dataset
      const unit = this.data.currentUnitIndex; const blockNumber = this.data.currentBlockIndex; const option = Number(optionIndex)
      const block = this.data.preparedUnits[unit]?.blocks[blockNumber]
      if (!block || block.type !== 'checkpoint') return
      const multiple = block.questionType === 'multiple_choice'
      const options = block.options.map((item) => ({ ...item, selected: multiple ? (item.index === option ? !item.selected : item.selected) : item.index === option }))
      this.setBlockState(unit, blockNumber, { options, hasSelection: options.some((item) => item.selected), feedback: null })
    },
    submitCheckpoint() {
      const unit = this.data.currentUnitIndex; const blockNumber = this.data.currentBlockIndex
      const block = this.data.preparedUnits[unit]?.blocks[blockNumber]
      if (!block || block.type !== 'checkpoint') return
      const selectedIndexes = block.options.filter((option) => option.selected).map((option) => option.index).sort((a, b) => a - b)
      if (!selectedIndexes.length) return
      const correctIndexes = [...block.correctIndexes].sort((a, b) => a - b)
      const correct = sameIndexes(selectedIndexes, correctIndexes)
      const feedback = { correct, text: correct ? '回答正确' : '回答不正确', explanation: block.explanation }
      this.setBlockState(unit, blockNumber, { feedback })
      this.triggerEvent('checkpoint-answered', { blockKey: block.key, correct, selectedIndexes })
    },
    selectScenarioChoice(event) {
      const { choiceIndex } = event.currentTarget.dataset
      const unit = this.data.currentUnitIndex; const blockNumber = this.data.currentBlockIndex; const choice = Number(choiceIndex)
      const block = this.data.preparedUnits[unit]?.blocks[blockNumber]
      if (!block || block.type !== 'scenario' || !block.scenarioChoices[choice]) return
      this.setBlockState(unit, blockNumber, {
        scenarioChoices: block.scenarioChoices.map((item) => ({ ...item, selected: item.index === choice })),
        scenarioFeedback: block.scenarioChoices[choice]
      })
    },
    confirmBlockReached() {
      const block = this.data.currentBlock
      if (!block || !this.data.canContinue) return
      const shouldSave = block.globalIndex > this.data.completedThrough
      if (shouldSave) {
        this.setData({ completedThrough: block.globalIndex, canContinue: true })
      }
      if (!block.isLast) this.activateBlock(block.globalIndex + 1)
      if (shouldSave) wx.nextTick(() => {
        if (!this._detached) this.triggerEvent('block-reached', { blockKey: block.key, progressPercent: block.progressPercent, isLast: block.isLast, confirmed: true })
      })
    },
    showPreviousBlock() {
      if (this.data.activeGlobalIndex > 0) this.activateBlock(this.data.activeGlobalIndex - 1)
    }
  }
})
