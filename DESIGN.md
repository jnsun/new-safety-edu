---
name: "安全生产管理系统管理端"
description: "克制、可信、以任务处置为中心的浅色 Ant Design 管理界面。"
colors:
  primary-blue: "#0071e3"
  primary-blue-hover: "#0077ed"
  authority-navy: "#123452"
  ink: "#1d1d1f"
  text-secondary: "#6e6e73"
  page-canvas: "#f5f5f7"
  surface: "#ffffff"
  soft-action: "#f6f7f9"
  soft-action-hover: "#f1f6fb"
  anomaly-ink: "#9d2c00"
  anomaly-surface: "#fff0e8"
  field-border: "#d2d2d7"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(28px, 2.4vw, 36px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  money:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "clamp(36px, 4vw, 58px)"
    fontWeight: 650
    lineHeight: 1.12
    letterSpacing: "-0.05em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, PingFang SC, Microsoft YaHei, sans-serif"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, PingFang SC, Microsoft YaHei, sans-serif"
    fontSize: "12px"
    fontWeight: 650
    letterSpacing: "0.08em"
rounded:
  count: "10px"
  control: "12px"
  table: "18px"
  card: "20px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "30px"
  page-x: "42px"
components:
  button-primary:
    backgroundColor: "{colors.primary-blue}"
    textColor: "{colors.surface}"
  button-primary-hover:
    backgroundColor: "{colors.primary-blue-hover}"
    textColor: "{colors.surface}"
  authority-panel:
    backgroundColor: "{colors.authority-navy}"
    textColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "30px"
  action-row:
    backgroundColor: "{colors.soft-action}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "11px 12px"
    height: "68px"
  action-row-hover:
    backgroundColor: "{colors.soft-action-hover}"
    textColor: "{colors.ink}"
  anomaly-count:
    backgroundColor: "{colors.anomaly-surface}"
    textColor: "{colors.anomaly-ink}"
    rounded: "{rounded.count}"
    size: "34px"
---

# Design System: 安全生产管理系统管理端

## Overview

**Creative North Star: "权威账本工作台"**

这个系统像一张经过整理的权威账本：浅色管理壳保持安静，真正需要判断的金额和动作才获得对比度。它延续主系统的 Ant Design 语言、系统字体和蓝色操作语义，不另建财务子品牌。

应收账款是这个世界的耐久扩展。首屏从权威金额进入异常处置或催收行动，再回到同一台账完成工作；角色文案和动作跟随服务端能力，视觉层级不暗示用户拥有未授权能力。

**Key Characteristics:**

- 浅灰画布、白色容器和紧凑的管理密度。
- 深海军蓝金额面板只承载最权威的财务事实。
- 蓝色只表示主操作或可进入路径，橙色只表示非零异常数量。
- 数字使用紧凑字距和等宽数字特性，便于快速核对。
- 桌面双栏、窄屏单栏，任务顺序在响应式变化中保持不变。

## Colors

整体是冷静的浅色中性基底；深蓝建立权威，清晰蓝引导操作，橙色只发出有限的异常信号。

### Primary

- **清晰操作蓝**：用于主按钮、当前导航和可进入链接；它表达动作，不承担装饰。
- **权威海军蓝**：用于应收余额等需要最高信任和对比度的核心事实面板。

### Secondary

- **克制异常橙**：只用于非零异常计数的文字和浅底，不扩散到整张卡片或一般状态。

### Neutral

- **墨色正文**：标题、主要正文和关键分类名称。
- **次级石墨**：说明、辅助标签和弱化数字。
- **冷灰画布**：全局页面背景，使白色内容容器自然分层。
- **白色表面**：卡片、输入和深色面板上的反白内容。
- **轻行动底色**：可点击任务行的静止与悬停表面。
- **字段边界灰**：输入、选择器等 Ant Design 字段的清晰轮廓。

### Named Rules

**The Three-Signal Rule.** 深蓝表示权威金额，蓝色表示动作，橙色表示异常；不要让三种信号互换职责。

**The Orange-Count Rule.** 橙色只标记非零异常数量，不用作大面积背景、普通提醒或品牌强调。

## Typography

**Display Font:** 系统无衬线字体栈（优先 Apple 系统字体与苹方，回退微软雅黑和 sans-serif）

**Body Font:** 与标题共用系统无衬线字体栈

**Label/Mono Font:** 标签共用系统字体；金额通过 `tabular-nums` 获得稳定列宽

**Character:** 字体选择务实、清晰、接近原生平台。层级来自字号、字重、负字距和留白，不靠额外字体制造品牌分裂。

### Hierarchy

- **Headline**（600，响应式 28–36px，1.12）：页面标题，紧凑但不压迫。
- **Money**（650，响应式 36–58px，1.12）：只用于首要金额事实，并允许长金额安全换行。
- **Body**（常规系统字号）：说明、表单和数据内容，以 Ant Design 默认密度为基线。
- **Label**（650，12px，0.08em）：深色权威面板上的范围提示等短标签。

### Named Rules

**The Numeric Authority Rule.** 所有金额与计数使用等宽数字；只有一个金额可以占据页面最高字号层级。

## Layout

主内容区居中，最大宽度 1560px，桌面页边距使用 42px；常规卡片和分区以 16px 为主要间距。页面标题先交代角色与当前任务，紧凑筛选条随后限定数据范围。

应收工作台的首层是 1.18:0.82 的双栏：左侧为权威金额，右侧为角色化动作。第二层使用等宽双栏承载债权状态与单位分布。900px 以下首层改为单栏，768px 以下内容水平边距收至 16px，金额摘要也由三列改为纵向行；在 390px 宽度不得产生页面级横向滚动。

**The Same-Order Rule.** 响应式只改变列数，不改变“金额事实 → 异常或催收行动 → 分类缩小范围”的任务顺序。

## Elevation & Depth

系统以轻微边框、白色表面和低强度环境阴影分层。普通筛选条保持扁平；标准卡片只有柔和环境深度；权威金额面板用更深、带海军蓝色相的阴影与浅色区域分离。焦点不是阴影装饰，而是明确的三像素蓝色轮廓。

### Shadow Vocabulary

- **标准卡片** (`0 1px 2px rgba(0, 0, 0, .02), 0 12px 38px rgba(0, 0, 0, .045)`)：普通信息容器的低强度环境层次。
- **权威面板** (`0 18px 40px rgba(18, 52, 82, .16)`)：仅用于深海军蓝核心事实面板。
- **表格容器** (`0 8px 30px rgba(0, 0, 0, .035)`)：为密集台账建立轻微边界，不制造悬浮感。

**The Flat-Filter Rule.** 筛选器依靠边框与间距成立，不使用卡片阴影争夺首屏注意力。

## Shapes

轮廓整体柔和但克制：标准卡片使用 20px 圆角，表格区域使用 18px，行动行使用 12px，异常计数使用 10px；标签可用完整胶囊形。圆角表达容器层级，不能把每段文字都包装成胶囊。

## Components

### Buttons

- **Shape:** 保留 Ant Design 原生按钮尺寸与轮廓；页面内的列表动作使用真正的 `<button>` 元素。
- **Primary:** 清晰操作蓝底配白字，只给当前角色最主要且确实获授权的动作。
- **Hover / Focus:** 主按钮悬停略微提亮；自定义按钮必须具有三像素半透明蓝色 `:focus-visible` 轮廓和 2px 外偏移。
- **Inverse:** 深色金额面板内使用白底海军蓝字按钮，避免再叠加高饱和蓝。

### Chips

- **Style:** 异常计数是 34px 的紧凑圆角计数块；零值保持中性，非零值才切换到浅橙底与深橙字。
- **State:** “进入”是蓝色文字动作，不伪装成异常状态。

### Cards / Containers

- **Corner Style:** 普通卡片柔和圆角；筛选卡与权威面板共享容器轮廓但使用不同深度。
- **Background:** 普通容器为白色或轻透明白，任务行使用轻行动底色，权威面板为纯深海军蓝。
- **Shadow Strategy:** 遵循 Elevation & Depth；筛选条无阴影，权威面板使用专属阴影。
- **Internal Padding:** 标准节奏为 16–24px；权威面板桌面为 30px，窄屏收至 20px 水平内边距。

### Inputs / Fields

- **Style:** 使用 Ant Design 输入与选择器，白底、字段边界灰，不另造控件语言。
- **Focus:** 保留可见键盘焦点；筛选项在窄屏占满可用宽度。
- **Error / Disabled:** 使用 Ant Design 既有错误与禁用语义，不用颜色以外的新隐喻。

### Navigation

侧栏保持紧凑的 46px 菜单行和 12px 圆角；选中项使用浅蓝底与深蓝字。应收账款页面内部的所有入口必须携带当前筛选并落到真实台账状态。

### Authority Panel

深蓝金额面板是应收工作台的签名组件。它先显示当前筛选范围，再显示唯一的主金额，下方用三项辅助事实和一个反白按钮收束；不得加入趋势图、渐变、装饰图标或未经确认的经营指标。

### Action Row

任务行以标题、解释和右侧计数或“进入”组成。整行可点击、使用原生按钮，并在悬停和键盘焦点时给出明确反馈；角色化文案只能消费服务端 capability。

## Do's and Don'ts

### Do:

- **Do** 让应收余额成为首屏唯一的最高对比度金额事实。
- **Do** 使用服务端能力决定角色标题、说明和动作，并让每个分类入口产生真实筛选。
- **Do** 在 900px 以下转为单栏，并验证 390px 宽度没有遮挡或页面级横向溢出。
- **Do** 为自定义可点击行使用原生按钮和可见的 `:focus-visible` 状态。
- **Do** 延续主系统的 Ant Design 控件、系统字体、浅色壳和蓝色操作语义。

### Don't:

- **Don't** 建立第二套财务品牌、图标语言或陌生交互。
- **Don't** 用装饰性渐变、玻璃拟态、无意义动画或同权重统计卡稀释任务层级。
- **Don't** 用橙色装饰一般信息，或在异常为零时制造风险感。
- **Don't** 从前端身份、筛选器或部门选择推断权限。
- **Don't** 在工作台加入未经产品确认的逾期阈值、趋势、回款目标或提醒指标。
