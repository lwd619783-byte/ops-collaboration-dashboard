# 设计系统 V1

界面采用克制的 Slate/Sky 色系，以留白、边框、清晰层级和文字状态传达信息。`AppLayout` 提供桌面侧栏、移动端顶栏和抽屉、页头与主内容区；导航定义集中在 `src/app/navigation/appNavigation.ts`。

后续页面应复用 `Button` 的 primary、secondary、danger、ghost 变体，使用 `Badge` 与 `StatusBadge` 展示状态；任务状态映射集中在 `src/lib/status/taskStatus.ts`。表单使用 `InputField`、`SelectField`，错误通过 `aria-describedby` 与控件关联。

`Dialog` 使用原生 `dialog` 的模态语义，必须提供标题、说明、取消和明确操作。空、加载、错误、无权状态分别使用对应 feedback 组件，不混用语义。

日期仅用 `DateDisplay`：date-only 按日历日期解析；date-time 必须带 `Z` 或时区偏移，默认以 `Asia/Shanghai` 显示。移动端菜单可关闭、带遮罩并支持 Escape；所有新增交互控件须具备可访问名称和可见焦点。
