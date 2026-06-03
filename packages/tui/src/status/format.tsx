/** status/format.tsx — 状态格式化函数
 *  将各种状态数据格式化为可读的终端显示文本。
 */

/**
 * 格式化数字为紧凑形式
 *
 * 转换规则：
 * - >= 1,000,000: 显示为 x.xM（如 1.2M）
 * - >= 1,000: 显示为 xK（如 12K）
 * - < 1,000: 原样显示
 *
 * 使用场景：状态栏显示 Token 数、上下文大小等
 *
 * @param n - 要格式化的数字
 * @returns 格式化后的字符串
 */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/**
 * 格式化缓存命中率
 *
 * @param hit - 缓存命中 token 数
 * @param miss - 缓存未命中 token 数
 * @returns 命中率百分比字符串（如 "85%"），无数据时返回 "--"
 */
export function formatCacheRate(hit: number, miss: number): string {
  const total = hit + miss;
  if (total === 0) return '--';
  return `${Math.round((hit / total) * 100)}%`;
}

/**
 * 格式化时间戳为相对时间
 *
 * 转换规则：
 * - < 1 分钟: "刚刚"
 * - < 1 小时: "X 分钟前"
 * - < 24 小时: "X 小时前"
 * - < 7 天: "X 天前"
 * - >= 7 天: 显示具体日期 "M/D"
 *
 * 使用场景：会话列表显示最后活动时间
 *
 * @param ts - 时间戳（毫秒）
 * @returns 格式化后的时间字符串
 */
export function formatRelativeTime(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * 格式化持续时间
 *
 * 将毫秒数转换为可读的时间字符串：
 * - < 1 秒: "Xms"
 * - < 1 分钟: "Xs"
 * - < 1 小时: "Xm Xs"
 * - >= 1 小时: "Xh Xm"
 *
 * 使用场景：显示工具执行时间、会话持续时间
 *
 * @param ms - 毫秒数
 * @returns 格式化后的时间字符串
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * 格式化 Token 生成速度
 *
 * @param tps - tokens per second
 * @returns 格式化后的速度字符串
 *   - 超过 1000 t/s 时显示为 x.xk 格式
 *   - 否则显示为整数
 */
export function formatTokenRate(tps: number): string {
  if (tps >= 1000) return `${(tps / 1000).toFixed(1)}k`;
  return String(Math.round(tps));
}

/**
 * 格式化文件大小
 *
 * 将字节数转换为可读的大小字符串：
 * - < 1 KB: "X B"
 * - < 1 MB: "X.X KB"
 * - < 1 GB: "X.X MB"
 * - >= 1 GB: "X.X GB"
 *
 * 使用场景：显示文件大小、内存占用
 *
 * @param bytes - 字节数
 * @returns 格式化后的大小字符串
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
