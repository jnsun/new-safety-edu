const { isTestEnvironment } = require('../../config/env')

Component({
  data: { visible: false },
  lifetimes: {
    attached() { this.setData({ visible: isTestEnvironment() }) }
  }
})
