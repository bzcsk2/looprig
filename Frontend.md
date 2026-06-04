你是一个前端 TypeScript 代码维护 agent。请为当前项目前端 TS/TSX 代码补充中文注释，详细代码列表在下面，目标是让后续人类维护者能快速理解程序逻辑，以及知道哪些参数可以修改来控制页面显示效果。

## 任务目标

1. 给核心业务逻辑、组件渲染逻辑、状态流转逻辑、事件处理逻辑补充中文注释。
2. 给控制显示效果的参数补充中文说明，包括但不限于：

   * 尺寸：width、height、maxWidth、minHeight、padding、margin、gap 等；
   * 颜色：color、background、borderColor、theme token 等；
   * 字体：fontSize、fontWeight、lineHeight、letterSpacing 等；
   * 布局：flex、grid、position、zIndex、overflow、align、justify 等；
   * 动画：duration、delay、easing、transition、transform 等；
   * 响应式：breakpoint、media query、mobile/tablet/desktop 分支；
   * 图表/可视化参数：scale、radius、opacity、strokeWidth、labelOffset、axis、legend 等。
3. 对每个关键组件补充顶部说明，说明：

   * 该组件负责什么；
   * 输入 props 的作用；
   * 内部 state 的含义；
   * 用户交互如何影响 UI；
   * 修改哪些参数会改变显示效果。
4. 对关键函数补充 JSDoc 风格中文注释，说明：

   * 函数用途；
   * 参数含义；
   * 返回值；
   * 副作用；
   * 注意事项。
5. 对复杂条件判断、坐标计算、样式计算、数据转换逻辑补充行内注释，说明“为什么这样做”，而不是重复代码表面含义。

## 严格限制

1. 不要改变任何运行逻辑。
2. 不要修改 UI 的实际显示效果。
3. 不要重构代码结构。
4. 不要改变量名、函数名、组件名、文件名，除非原代码存在明显拼写错误且必须修改；如需修改，先在输出中说明原因。
5. 不要批量格式化文件，避免产生无意义 diff。
6. 不要添加英文注释，除非原项目约定必须保留英文术语。
7. 不要为显而易见的代码添加噪音注释，例如 `count++ // count 加 1`。
8. 不要删除已有注释；如已有注释过时或错误，请修正并说明。

## 注释风格要求

1. 中文注释要面向“接手维护的人”，不是面向编译器。
2. 注释重点解释：

   * 业务意图；
   * 数据流；
   * 状态变化；
   * 条件分支原因；
   * 显示参数的可调范围；
   * 修改参数后的视觉影响。


## 输出要求

1. 直接修改代码文件。
2. 完成后输出：

   * 修改了哪些文件；
   * 每个文件主要补充了哪些注释；
   * 哪些参数是控制显示效果的关键参数；
   * 是否运行了类型检查、lint、测试或构建命令；
   * 如未运行，请说明原因。
3. 最终输出必须包含简短验收清单：

* [ ] 代码逻辑未改变
* [ ] UI 效果未改变
* [ ] 核心组件已有中文说明
* [ ] 关键函数已有中文 JSDoc
* [ ] 显示参数已有修改方法说明
* [ ] 未产生无意义格式化 diff

请先扫描项目结构，识别主要前端入口、组件目录、样式目录和可视化/布局相关文件，然后按上述要求执行。



根据对 `deepicode` 项目 `packages/tui/src` 目录下源代码的完整梳理，控制 **TUI 显示风格**（颜色、布局、视觉组件）和 **字样**（文本内容、提示语）的核心文件可以归为以下几类：

---

### 一、主题与颜色风格（全局调色盘）

| 文件 | 作用 |
|------|------|
| **`packages/tui/src/reasonix/tokens.ts`** | **最核心的风格定义文件**。定义了 `dark` 主题的全部颜色令牌，包括：<br>• 前景色（`fg`：strong/body/sub/meta/faint）<<br>• 色调（`tone`：brand/accent/ok/warn/err/info）<<br>• 表面色（`surface`：bg/bgInput/bgCode/bgElev）<<br>所有组件都通过 `FG`、`TONE`、`SURFACE` 这三个代理对象引用颜色，修改此文件即可改变全局配色。 |

---

### 二、文本与字样（国际化 / i18n）

| 文件 | 作用 |
|------|------|
| **`packages/tui/src/i18n/zh-CN.ts`** | 中文界面全部文本：占位符、状态栏标签、权限提示、命令帮助、加载提示等。 |
| **`packages/tui/src/i18n/en.ts`** | 英文界面全部文本，与 `zh-CN.ts` 一一对应。 |
| **`packages/tui/src/i18n/index.ts`** | i18n 入口，控制当前激活语言（`activeLocale`）的切换逻辑。 |
| **`packages/tui/src/i18n/strings.ts`** | 文本类型定义（约束 `zh-CN.ts` 和 `en.ts` 的结构）。 |

---

### 三、布局与容器风格

| 文件 | 作用 |
|------|------|
| **`packages/tui/src/FullscreenLayout.tsx`** | 全屏/非全屏布局切换、终端头部（`TerminalHeader`）的标题样式（`deepicode agent terminal`）。 |
| **`packages/tui/src/App.tsx`** | 主应用框架，控制整体界面结构：警告框（⚠）、错误框（✗）、权限弹窗挂载点、搜索覆盖层、模型/会话选择器的显隐逻辑。 |

---

### 四、消息与卡片显示风格

| 文件 | 作用 |
|------|------|
| **`packages/tui/src/DeepiMessages.tsx`** | 消息列表整体渲染：用户消息前缀（`❯`）、助手消息、Reasoning 思考卡片、工具调用折叠面板、普通消息流式显示。 |
| **`packages/tui/src/reasonix/StreamingCard.tsx`** | **流式输出卡片**的视觉风格：头部颜色（品牌绿/错误红）、旋转点动画、token 速率显示、行数截断提示（`...+n 行`）。 |
| **`packages/tui/src/reasonix/ToolCard.tsx`** | **工具调用卡片**的视觉风格：状态图标（◉/✓/✗/⊘）、头部颜色（按状态变化）、参数摘要截断、输出预览行数控制。 |
| **`packages/tui/src/reasonix/Card.tsx`** | 基础卡片容器（背景色 `SURFACE.bgElev`、边框圆角/内边距）。 |
| **`packages/tui/src/reasonix/CardHeader.tsx`** | 卡片头部统一样式：图标、标题、副标题、元数据（meta items）颜色。 |
| **`packages/tui/src/ToolCallBanner.tsx`** | 顶部工具调用横幅：运行状态图标（⏺/✓/✗）和颜色（warning/success/error）。 |

---

### 五、输入与交互风格

| 文件 | 作用 |
|------|------|
| **`packages/tui/src/DeepiPromptInput.tsx`** | 输入框样式：前缀符号（`❯`）、光标（`▊`）、占位符文本（`输入消息...` / `Type a message...`）、加载中提示、队列提示。 |
| **`packages/tui/src/StatusBar.tsx`** | **底部状态栏**样式与文本：模型名、Agent、Token 统计（入/出/缓存命中率）、上下文占用比、当前工作目录、思考模式标签、待注入任务数。 |
| **`packages/tui/src/Spinner.tsx`** | 加载动画（Braille 点阵旋转）。 |
| **`packages/tui/src/reasonix/Spinner.tsx`** | 另一版加载动画（圆形四帧旋转），被 `StreamingCard` 和 `ToolCard` 引用。 |

---

### 六、弹窗与覆盖层风格

| 文件 | 作用 |
|------|------|
| **`packages/tui/src/ModelPicker.tsx`** | 模型选择器 UI：服务商列表、API Key 输入、模型列表、当前选中标记（`❯`）、快捷键提示字样。 |
| **`packages/tui/src/PermissionPrompt.tsx`** | 权限确认弹窗：标题（🔐）、工具名、命令参数、选项（允许/始终允许/拒绝）、操作提示字样。 |
| **`packages/tui/src/SessionPicker.tsx`** | 会话选择器 UI（未展开查看，但负责会话列表的显示风格）。 |
| **`packages/tui/src/SearchOverlay.tsx`** | 搜索覆盖层 UI（未展开查看）。 |
| **`packages/tui/src/CommandAutocomplete.tsx`** | 命令自动补全 UI（未展开查看）。 |

---

### 七、Markdown 与文本渲染

| 文件 | 作用 |
|------|------|
| **`packages/tui/src/reasonix/markdown.tsx`** | Markdown 渲染组件（9584 字节），控制代码块、列表、粗体等富文本在终端内的样式。 |
| **`packages/tui/src/markdown.ts`** | 另一版 Markdown 处理逻辑（5798 字节）。 |

---

### 总结：如果你想修改 TUI 的"风格"和"字样"

- **改颜色 / 视觉风格** → 优先看 **`tokens.ts`**，然后看具体组件（`StreamingCard.tsx`、`ToolCard.tsx`、`StatusBar.tsx`、`DeepiMessages.tsx` 等）。
- **改文字 / 提示语** → 直接编辑 **`zh-CN.ts`** 或 **`en.ts`**（所有面向用户的文本都集中在这里）。
- **改布局结构** → 看 **`App.tsx`** 和 **`FullscreenLayout.tsx`**。