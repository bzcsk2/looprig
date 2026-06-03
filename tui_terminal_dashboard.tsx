import React, { useState, useEffect } from 'react';

// 调整后的全新调色板配置 (去紫改蓝)
const COLORS = {
  bg: '#000000',         // 纯黑背景
  text: '#E1D3DC',       // 浅灰粉主文字
  dimText: '#8D7B88',    // 偏暗辅助文字
  green: '#00FF66',      // 经典高亮翠绿
  blue: '#4A90E2',       // 链接/命令亮蓝
  blueBg: '#1D3B5C',     // 输入框/历史气泡背景蓝
  blueText: '#FFFFFF',   // 提示框白色文字
};

export default function App() {
  const [inputValue, setInputValue] = useState('explain this codebase');
  const [cursorVisible, setCursorVisible] = useState(true);
  const [history, setHistory] = useState([]);

  // 模拟光标闪烁
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 600);
    return () => clearInterval(interval);
  }, []);

  // 简单的输入框回车提交模拟
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      setHistory([...history, inputValue]);
      setInputValue('');
    }
  };

  return (
    <div 
      className="min-h-screen w-full flex flex-col justify-center items-center p-4 md:p-8"
      style={{ backgroundColor: '#000000' }} // 整个外层背景设为黑色
    >
      {/* 模拟终端视窗容器 */}
      <div 
        className="w-full max-w-4xl rounded-lg shadow-2xl border border-[#222222] overflow-hidden flex flex-col font-mono text-[14px] leading-relaxed"
        style={{ backgroundColor: COLORS.bg, color: COLORS.text }} // 终端内层背景设为纯黑
      >
        {/* 终端头部装饰栏 */}
        <div className="bg-[#0c0c0c] px-4 py-2 flex items-center justify-between border-b border-[#222222] select-none">
          <div className="flex space-x-2">
            <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
            <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
            <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
          </div>
          <span className="text-xs tracking-wider" style={{ color: COLORS.dimText }}>Agent Terminal (TUI Preview)</span>
          <div className="w-12" /> {/* 占位平衡 */}
        </div>

        {/* 终端主内容区 */}
        <div className="p-4 md:p-6 overflow-y-auto flex-1 space-y-5">
          
          {/* 1. 优先复测列表 */}
          <div>
            <p style={{ color: COLORS.text }}>修复后只需优先复测：</p>
            <div className="pl-4 mt-2 space-y-1">
              <p style={{ color: COLORS.text }}>G0-01</p>
              <p style={{ color: COLORS.text }}>G1-01</p>
              <p style={{ color: COLORS.text }}>G1-02</p>
              <p style={{ color: COLORS.text }}>G1-09</p>
              <p style={{ color: COLORS.text }}>G2-05</p>
              <p style={{ color: COLORS.text }}>G4-01</p>
            </div>
          </div>

          {/* 2. 结论段落 */}
          <div>
            <p style={{ color: COLORS.text }}>
              其余 PTY 和平台测试再继续展开。当前有效结论是：存在一个明确的{' '}
              <span className="font-bold">P1 生命周期 Bug</span>，系统验收尚未通过。
            </p>
          </div>

          {/* 3. 分割线 */}
          <div className="flex items-center space-x-2 select-none">
            <span className="whitespace-nowrap" style={{ color: COLORS.dimText }}>- Worked for 2m 26s</span>
            <div className="h-[1px] w-full" style={{ backgroundColor: '#222222' }} />
          </div>

          {/* 4. 修改为蓝色系的提示 Block (原紫色) */}
          <div 
            className="rounded px-4 py-2.5 shadow-inner"
            style={{ backgroundColor: COLORS.blueBg, color: COLORS.blueText }}
          >
            <p className="font-semibold">› 你先把Bug的修复方法更新到TODO中</p>
          </div>

          {/* 5. 详细日志树形区域 */}
          <div className="space-y-4">
            {/* 树形主节点 1 */}
            <div className="flex items-start">
              <span className="mr-2 select-none" style={{ color: COLORS.green }}>•</span>
              <p>
                我会先查看 <span className="underline cursor-pointer" style={{ color: COLORS.blue }}>TODO.md</span> 当前结构，把已确认的生命周期 <span className="font-bold">Bug</span> 和日志可读性问题放进未完成事项，并写清修复边界、禁止做法和验收用例，避免后续 Agent 只加 <span className="font-bold" style={{ color: COLORS.blue }}>process.exit()</span> 规避问题。
              </p>
            </div>

            {/* 树形子结构 - Explored */}
            <div className="pl-6 space-y-1 border-l border-[#222222] ml-2">
              <div className="flex items-center">
                <span className="mr-2 select-none" style={{ color: COLORS.green }}>•</span>
                <span className="font-semibold">Explored</span>
              </div>
              <div className="pl-4 flex items-center">
                <span className="mr-2 select-none" style={{ color: COLORS.dimText }}>└─</span>
                <span className="mr-1" style={{ color: COLORS.green }}>Read</span>
                <span className="underline cursor-pointer">TODO.md</span>
              </div>
              <div className="pl-4 flex items-start">
                <span className="mr-2 select-none" style={{ color: COLORS.dimText }}>&nbsp;&nbsp;</span>
                <span className="mr-1 select-none" style={{ color: COLORS.blue }}>Search</span>
                <p>
                  BUG|日志|<span className="font-bold">log</span>|生命周期|shutdown|OS-|下一步|Phase|优先|验收|TODO|未完成 <span style={{ color: COLORS.dimText }}>in TODO.md</span>
                </p>
              </div>
            </div>

            {/* 树形子结构 - Ran git status */}
            <div className="pl-6 space-y-1 border-l border-[#222222] ml-2">
              <div className="flex items-center">
                <span className="mr-2 select-none" style={{ color: COLORS.green }}>•</span>
                <span className="mr-1">Ran</span>
                <span className="font-bold">git status --short --branch</span>
              </div>
              <div className="pl-4 flex flex-col">
                <div className="flex items-center">
                  <span className="mr-2 select-none" style={{ color: COLORS.dimText }}>└─</span>
                  <span style={{ color: COLORS.dimText }}>## master...origin/master [ahead 44]</span>
                </div>
                <div className="pl-6 flex items-center">
                  <span className="mr-2" style={{ color: COLORS.dimText }}>M</span>
                  <span style={{ color: COLORS.dimText }}>TEST.md</span>
                </div>
              </div>
            </div>
          </div>

          {/* 6. 状态更新区域 */}
          <div className="pt-4 border-t border-[#222222] space-y-3">
            <div className="flex items-start">
              <span className="mr-2 select-none" style={{ color: COLORS.blue }}>•</span>
              <p>
                <span className="underline cursor-pointer" style={{ color: COLORS.blue }}>TODO.md</span> 目前仍把下一步写成平台验收，已经过时。我会把生命周期修复提升为第一优先级，并将日志误脱敏与测试稳定性拆成独立小目标，写清涉及文件、最小实现方式和关闭条件。
              </p>
            </div>
            <div className="pl-6 flex items-center space-x-2">
              <span className="animate-pulse w-2 h-2 rounded-full" style={{ backgroundColor: COLORS.green }} />
              <span style={{ color: COLORS.dimText }}>Working (41s • esc to interrupt)</span>
            </div>
          </div>

          {/* 7. 输入交互区域 */}
          <div className="space-y-2">
            {history.map((cmd, i) => (
              <div 
                key={i} 
                className="rounded px-4 py-2.5 flex items-center opacity-70"
                style={{ backgroundColor: '#13283f' }} // 历史用户气泡修改为深蓝底色
              >
                <span className="mr-2 select-none font-bold" style={{ color: COLORS.green }}>❯</span>
                <span className="text-white">{cmd}</span>
              </div>
            ))}

            <div 
              className="rounded px-4 py-2.5 flex items-center shadow-md focus-within:ring-1 focus-within:ring-[#4A90E2] transition-all"
              style={{ backgroundColor: COLORS.blueBg }} // 输入框改用深蓝底色
            >
              <span className="mr-2 select-none font-bold" style={{ color: COLORS.green }}>❯</span>
              <input 
                type="text" 
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                className="bg-transparent border-none outline-none flex-1 text-white placeholder-blue-300 font-mono"
                style={{ caretColor: 'transparent' }}
                placeholder="type a command here..."
                autoFocus
              />
              <span 
                className={`w-2.5 h-5 bg-white ml-0.5 ${cursorVisible ? 'opacity-100' : 'opacity-0'}`} 
                style={{ transition: 'opacity 150ms' }}
              />
            </div>
          </div>

        </div>

        {/* 8. 底部状态栏 */}
        <div className="bg-[#0c0c0c] px-4 py-3 flex items-center justify-between border-t border-[#222222] text-xs select-none">
          <span style={{ color: COLORS.dimText }}>gpt-5.5 medium</span>
          <span style={{ color: COLORS.green }}>/vol4/Agent</span>
        </div>
      </div>
    </div>
  );
}