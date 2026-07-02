/**
 * Hello Plugin - 示例插件
 *
 * 这个插件展示如何创建一个简单的 tool 插件。
 * 它提供了一个 greet 工具，可以问候用户。
 *
 * 使用方法：
 * 1. 将此文件复制到你的项目中
 * 2. 在 .covalo/plugins.json 中添加此插件路径
 * 3. 重启 covalo
 */

export default {
  id: "hello",

  server: () => ({
    /** Personalized greeting */
    greet: async (args: { name: string }) => {
      if (!args?.name || args.name.trim() === "") {
        throw new Error("Invalid input: 'name' must be a non-empty string.")
      }
      return `Hello, ${args.name.trim()}! Welcome to covalo!`
    },

    /** Current time in ISO format */
    time: async () => {
      return `Current time: ${new Date().toISOString()}`
    },
  }),
}
