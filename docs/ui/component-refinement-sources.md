# 组件精修来源与许可记录

更新日期：2026-09-21

本轮没有复制第三方组件源码，也没有安装新的 UI、表格、动画或图标依赖。现有实现继续使用项目内的 React、Ant Design、TanStack Query 和 CSS；下列站点只用于核对交互结构和信息组织。

| 来源 | 查阅页面 | 用途 | 本地落点 | 源码/依赖处理 |
| --- | --- | --- | --- | --- |
| shadcn/ui | <https://ui.shadcn.com/docs/components/base/data-table> | 筛选区、服务端分页、金额列右对齐、空结果结构 | `apps/admin/src/ReceivablesLedger.tsx` | 仅参考；未复制源码，未安装 TanStack Table |
| shadcn/ui | <https://ui.shadcn.com/docs/components/base/sheet> | 课件选择和合同详情侧栏的信息层级 | `apps/admin/src/training/TrainingWorkflowPage.tsx`、`apps/admin/src/ReceivablesLedger.tsx` | 仅参考；继续使用 Ant Design Drawer |
| shadcn/ui | <https://ui.shadcn.com/docs/components/base/combobox> | 可搜索课件选择器 | `apps/admin/src/training/TrainingWorkflowPage.tsx` | 仅参考；继续使用 Input、Checkbox 和 Drawer |
| shadcn/ui | <https://ui.shadcn.com/docs/components/base/alert-dialog> | 未保存离开和危险操作确认 | 两个业务切片的现有 Modal.confirm | 仅参考；继续使用 Ant Design Modal |
| beUI | <https://beui.dev/components/motion/tabs> | 详情页签的信息分组 | `apps/admin/src/ReceivablesLedger.tsx` | 仅参考；未复制 Motion/Tailwind 源码，未安装依赖 |
| beUI | <https://beui.dev/components/blocks/file-upload> | 上传阶段文案和失败反馈 | `apps/admin/src/training/TrainingWorkflowPage.tsx` | 页面在查阅时不可稳定读取；未使用其源码 |
| beUI | <https://beui.dev/components/motion/animated-badge> | 状态标签候选 | 无 | 页面在查阅时不可稳定读取；本轮未采用 |
| Beautiful UI | <https://www.beautifului.dev/> | 准备度任务行、筛选区和差异表的信息组织 | 现有预检 Drawer、筛选区和 revision 冲突表 | 仅参考；未复制源码或素材 |
| Transitions.dev | <https://transitions.dev/> | Panel reveal、tabs 和 reduced-motion 原则 | `apps/admin/src/styles.css` | 仅参考；只使用项目自有 CSS 过渡，不复制付费或外部脚本 |
| Rare UI | <https://www.rareui.com/components/notificationbell> | 真实未读消息铃铛候选 | 无 | 本轮未采用；避免引入 Motion/Radix 依赖和持续动画 |

## 取舍

- 不安装 Tailwind，不启用 Preflight，不替换 Ant Design 表格引擎。
- 不采用 beUI Adaptive Stepper 或 Rare UI Step player；培训向导仍以已确认的 Figma 五步为准。
- 不采用滚动数字、假上传百分比、演示定时器、自动变化状态或持续摇摆消息铃铛。
- `prefers-reduced-motion: reduce` 下关闭本轮新增的列表和选择行过渡。

