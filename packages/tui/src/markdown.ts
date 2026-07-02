/**
 * Markdown → 纯文本/ANSI 字符串渲染器
 *
 * 本模块将 Markdown 文本解析为 AST 后，通过 formatToken 递归遍历
 * 生成带有 ANSI 颜色码的纯字符串（非 JSX 渲染）。
 * 适用于日志输出、文件摘要等无需交互式 UI 的场景。
 * 与 reasonix/markdown.tsx 不同，本模块输出的是字符串而非 React 组件。
 */

import chalk from 'chalk'
import { marked, type Token, type Tokens } from 'marked'
import stripAnsi from 'strip-ansi'
import { stringWidth } from '@covalo/ink'

const EOL = '\n'

/** marked 是否已配置的标志位，确保只初始化一次 */
let markedConfigured = false

/**
 * 配置 marked 解析器
 * 禁用默认的删除线（del）分词器，因为本模块不处理删除线渲染
 * 确保只初始化一次（通过 markedConfigured 标志位）
 */
export function configureMarked(): void {
  if (markedConfigured) return
  markedConfigured = true
  marked.use({
    tokenizer: {
      del() { return undefined },
    },
  })
}

/**
 * Markdown 渲染入口
 * @param content - 原始 Markdown 文本
 * @returns 带 ANSI 颜色码的渲染结果字符串
 * @sideEffect 首次调用时自动配置 marked 解析器
 */
export function applyMarkdown(content: string): string {
  configureMarked()
  return marked
    .lexer(content)
    .map(_ => formatToken(_, 0, null, null))
    .join('')
    .trim()
}

/**
 * 递归 Token 格式化函数（核心渲染逻辑）
 *
 * @param token - 当前待渲染的 Token
 * @param listDepth - 列表嵌套深度，用于控制缩进层级
 * @param orderedListNumber - 有序列表的当前序号，无序列表为 null
 * @param parent - 父 Token，用于上下文感知（如列表项内的文本格式）
 * @returns 带 ANSI 颜色码的渲染字符串
 *
 * 支持的 Token 类型：
 *   blockquote → 使用 dim 竖线（│）前缀 + 斜体
 *   code/codespan → 青色显示
 *   em → 斜体
 *   strong → 粗体
 *   heading → 粗体（h1 额外加下划线）
 *   list/list_item → 递归缩进，带序号
 *   table → 自适应列宽，支持左/中/右对齐
 *   link → 处理 mailto 前缀，显示"文本 (链接)"格式
 *   def/del/html → 忽略不渲染
 */
export function formatToken(
  token: Token,
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
): string {
  switch (token.type) {
    case 'blockquote': {
      const inner = (token.tokens ?? [])
        .map(_ => formatToken(_, 0, null, null))
        .join('')
      const bar = chalk.dim('│')
      return inner
        .split(EOL)
        .map(line => stripAnsi(line).trim() ? `${bar} ${chalk.italic(line)}` : line)
        .join(EOL)
    }
    case 'code': {
      return token.text + EOL
    }
    case 'codespan': {
      return chalk.cyan(token.text)
    }
    case 'em':
      return chalk.italic(
        (token.tokens ?? [])
          .map(_ => formatToken(_, 0, null, parent))
          .join(''),
      )
    case 'strong':
      return chalk.bold(
        (token.tokens ?? [])
          .map(_ => formatToken(_, 0, null, parent))
          .join(''),
      )
    case 'heading':
      switch (token.depth) {
        case 1:
          return chalk.bold.underline(
            (token.tokens ?? []).map(_ => formatToken(_, 0, null, null)).join('')
          ) + EOL + EOL
        case 2:
          return chalk.bold(
            (token.tokens ?? []).map(_ => formatToken(_, 0, null, null)).join('')
          ) + EOL + EOL
        default:
          return chalk.bold(
            (token.tokens ?? []).map(_ => formatToken(_, 0, null, null)).join('')
          ) + EOL + EOL
      }
    case 'hr':
      return '---'
    case 'image':
      return token.href
    case 'link': {
      if (token.href.startsWith('mailto:')) {
        return token.href.replace(/^mailto:/, '')
      }
      const linkText = (token.tokens ?? [])
        .map(_ => formatToken(_, 0, null, token))
        .join('')
      const plainLinkText = stripAnsi(linkText)
      if (plainLinkText && plainLinkText !== token.href) {
        return `${plainLinkText} (${token.href})`
      }
      return token.href
    }
    case 'list': {
      return token.items
        .map((_: Token, index: number) =>
          formatToken(_, listDepth, token.ordered ? token.start + index : null, token)
        )
        .join('')
    }
    case 'list_item':
      return (token.tokens ?? [])
        .map(_ =>
          `${'  '.repeat(listDepth)}${formatToken(_, listDepth + 1, orderedListNumber, token)}`
        )
        .join('')
    case 'paragraph':
      return (token.tokens ?? [])
        .map(_ => formatToken(_, 0, null, null))
        .join('') + EOL
    case 'space':
      return EOL
    case 'br':
      return EOL
    case 'text':
      if (parent?.type === 'list_item') {
        return `${orderedListNumber === null ? '-' : orderedListNumber + '.'} ${token.tokens ? token.tokens.map(_ => formatToken(_, listDepth, orderedListNumber, token)).join('') : token.text}${EOL}`
      }
      return token.text
    case 'table': {
      const tableToken = token as Tokens.Table
      function getDisplayText(tokens: Token[] | undefined): string {
        return stripAnsi(tokens?.map(_ => formatToken(_, 0, null, null)).join('') ?? '')
      }
      // 计算每列最大宽度（去除 ANSI 码后的纯文本宽度）
      const columnWidths = tableToken.header.map((header, index) => {
        let maxWidth = stringWidth(getDisplayText(header.tokens))
        for (const row of tableToken.rows) {
          const cellLength = stringWidth(getDisplayText(row[index]?.tokens))
          maxWidth = Math.max(maxWidth, cellLength)
        }
        return Math.max(maxWidth, 3)
      })
      let tableOutput = '| '
      tableToken.header.forEach((header, index) => {
        const content = header.tokens?.map(_ => formatToken(_, 0, null, null)).join('') ?? ''
        const displayText = getDisplayText(header.tokens)
        const width = columnWidths[index]!
        const align = tableToken.align?.[index]
        tableOutput += padAligned(content, stringWidth(displayText), width, align) + ' | '
      })
      tableOutput = tableOutput.trimEnd() + EOL
      tableOutput += '|'
      columnWidths.forEach(width => {
        tableOutput += '-'.repeat(width + 2) + '|'
      })
      tableOutput += EOL
      tableToken.rows.forEach(row => {
        tableOutput += '| '
        row.forEach((cell, index) => {
          const content = cell.tokens?.map(_ => formatToken(_, 0, null, null)).join('') ?? ''
          const displayText = getDisplayText(cell.tokens)
          const width = columnWidths[index]!
          const align = tableToken.align?.[index]
          tableOutput += padAligned(content, stringWidth(displayText), width, align) + ' | '
        })
        tableOutput = tableOutput.trimEnd() + EOL
      })
      return tableOutput + EOL
    }
    case 'escape':
      return token.text
    case 'def':
    case 'del':
    case 'html':
      return ''
  }
  return ''
}

/**
 * 对齐填充辅助函数
 * 根据对齐方式在内容两侧添加空格，使内容达到指定宽度
 *
 * @param content - 原始字符串（可含 ANSI 颜色码）
 * @param displayWidth - 去除 ANSI 码后的可见宽度
 * @param targetWidth - 目标对齐宽度
 * @param align - 对齐方式：left（左对齐）/ center（居中）/ right（右对齐）
 * @returns 填充空格后的字符串
 */
export function padAligned(
  content: string,
  displayWidth: number,
  targetWidth: number,
  align: 'left' | 'center' | 'right' | null | undefined,
): string {
  const padding = Math.max(0, targetWidth - displayWidth)
  if (align === 'center') {
    const leftPad = Math.floor(padding / 2)
    return ' '.repeat(leftPad) + content + ' '.repeat(padding - leftPad)
  }
  if (align === 'right') {
    return ' '.repeat(padding) + content
  }
  return content + ' '.repeat(padding)
}
