#!/usr/bin/env python3
"""
DeepSeek 官方 API 测试脚本

测试 DeepSeek 官方 V4 系列模型（deepseek-v4-flash / deepseek-v4-pro）。

使用方式:
  export DEEPSEEK_API_KEY="sk-..."
  python3 test_deepseek_v4_api.py

环境变量:
  DEEPSEEK_API_KEY    API 密钥（必填）
  DEEPSEEK_BASE_URL   API 地址（默认 https://api.deepseek.com）
  DEEPSEEK_MODEL      模型名（默认 deepseek-v4-flash）
"""

import os
import json
import sys
import time
from typing import Any

BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")

if not API_KEY:
    print("ERROR: 请设置 DEEPSEEK_API_KEY 环境变量")
    print("  export DEEPSEEK_API_KEY=\"sk-...\"")
    sys.exit(1)

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
    "User-Agent": "opencode-test/1.0",
}


def req(path: str, body: dict) -> dict:
    import urllib.request
    import urllib.error
    url = f"{BASE_URL}/{path.lstrip('/')}"
    data = json.dumps(body).encode("utf-8")
    req_obj = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req_obj, timeout=120) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  HTTP {e.code}: {body[:300]}")
        raise


def req_stream(path: str, body: dict):
    import urllib.request
    import urllib.error
    url = f"{BASE_URL}/{path.lstrip('/')}"
    data = json.dumps(body).encode("utf-8")
    req_obj = urllib.request.Request(url, data=data, headers=HEADERS, method="POST")
    try:
        with urllib.request.urlopen(req_obj, timeout=120) as resp:
            buf = b""
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                buf += chunk
                while b"\n\n" in buf:
                    raw, buf = buf.split(b"\n\n", 1)
                    for line in raw.decode("utf-8").split("\n"):
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str.strip() == "[DONE]":
                                return
                            yield json.loads(data_str)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"  HTTP {e.code}: {body[:300]}")
        raise


def section(title: str):
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def test_basic_chat():
    section("基础非流式对话")
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "你是一个助手，请简洁回答"},
            {"role": "user", "content": "Hello! 用中文回复一句话"},
        ],
        "stream": False,
    }
    t0 = time.time()
    resp = req("chat/completions", body)
    elapsed = time.time() - t0
    msg = resp["choices"][0]["message"]
    usage = resp.get("usage", {})
    print(f"  耗时: {elapsed:.2f}s")
    print(f"  回复: {msg.get('content','')}")
    print(f"  Token: {usage.get('total_tokens', 'N/A')}")
    print(f"  模型: {resp.get('model', MODEL)}")
    assert resp["object"] == "chat.completion"
    print("  ✅ 通过")


def test_streaming_chat():
    section("流式对话")
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "你是一个助手"},
            {"role": "user", "content": "从1数到5，用逗号分隔"},
        ],
        "stream": True,
    }
    t0 = time.time()
    chunks: list[str] = []
    reasoning_chunks: list[str] = []
    for event in req_stream("chat/completions", body):
        delta = event.get("choices", [{}])[0].get("delta", {})
        if delta.get("reasoning_content"):
            reasoning_chunks.append(delta["reasoning_content"])
        if delta.get("content"):
            chunks.append(delta["content"])
    elapsed = time.time() - t0
    content = "".join(chunks)
    print(f"  耗时: {elapsed:.2f}s")
    print(f"  回复: {content}")
    if reasoning_chunks:
        print(f"  思考过程: {''.join(reasoning_chunks)[:200]}...")
    assert len(chunks) > 0
    print("  ✅ 通过")


def test_tool_call():
    section("工具调用")
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": "北京现在天气怎么样？请调用 get_weather 工具查询"}],
        "tools": [{
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "获取指定城市的天气信息",
                "parameters": {
                    "type": "object",
                    "properties": {"city": {"type": "string", "description": "城市名称"}},
                    "required": ["city"],
                },
            },
        }],
        "stream": False,
    }
    t0 = time.time()
    resp = req("chat/completions", body)
    elapsed = time.time() - t0
    msg = resp["choices"][0]["message"]
    print(f"  耗时: {elapsed:.2f}s")
    if msg.get("tool_calls"):
        for tc in msg["tool_calls"]:
            print(f"  工具调用: {tc['function']['name']}({tc['function']['arguments']})")
        print("  ✅ 通过")
    else:
        print(f"  回复(无工具调用): {(msg.get('content') or '')[:200]}")
        print("  ⚠️ 模型未调用工具")


def test_tool_call_with_result():
    section("工具调用闭环")
    body_1 = {
        "model": MODEL,
        "messages": [{"role": "user", "content": "北京现在天气怎么样？请调用 get_weather 工具查询"}],
        "tools": [{
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "获取指定城市的天气信息",
                "parameters": {
                    "type": "object",
                    "properties": {"city": {"type": "string", "description": "城市名称"}},
                    "required": ["city"],
                },
            },
        }],
        "stream": False,
    }
    t0 = time.time()
    resp = req("chat/completions", body_1)
    elapsed = time.time() - t0
    assistant_msg = resp["choices"][0]["message"]
    print(f"  步骤1（触发工具调用）: {elapsed:.2f}s")
    if not assistant_msg.get("tool_calls"):
        print("  ⚠️ 模型未调用工具，跳过")
        return
    tool_call = assistant_msg["tool_calls"][0]
    body_2 = {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": "北京现在天气怎么样？请调用 get_weather 工具查询"},
            assistant_msg,
            {"role": "tool", "tool_call_id": tool_call["id"],
             "content": json.dumps({"city": "北京", "temperature": 22, "condition": "晴"})},
        ],
        "tools": body_1["tools"],
        "stream": False,
    }
    t1 = time.time()
    resp2 = req("chat/completions", body_2)
    elapsed2 = time.time() - t1
    content = (resp2["choices"][0]["message"].get("content") or "")
    print(f"  步骤2（返回工具结果）: {elapsed2:.2f}s")
    print(f"  模型回复: {content[:300]}")
    assert len(content) > 0
    print("  ✅ 通过")


def test_json_mode():
    section("JSON 输出模式")
    body = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "你是一个数据提取助手。请输出 JSON 格式。"},
            {"role": "user", "content": "从以下文本提取信息：张三，28岁，北京市朝阳区，软件工程师"},
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
        "max_tokens": 1000,
    }
    t0 = time.time()
    resp = req("chat/completions", body)
    elapsed = time.time() - t0
    content = resp["choices"][0]["message"].get("content", "")
    print(f"  耗时: {elapsed:.2f}s")
    try:
        parsed = json.loads(content)
        print(f"  解析成功: {json.dumps(parsed, ensure_ascii=False)}")
        print("  ✅ 通过")
    except json.JSONDecodeError:
        print(f"  解析失败: {content[:200]}")
        print("  ❌ 失败")


def test_thinking_mode():
    section("思考模式")
    print("\n  --- a: 默认（Official 默认无 reasoning_content）---")
    body = {
        "model": MODEL,
        "messages": [{"role": "user", "content": "请解方程: 2x + 5 = 15，一步步思考"}],
        "stream": False,
    }
    resp = req("chat/completions", body)
    msg = resp["choices"][0]["message"]
    print(f"  reasoning_content: {'有' if msg.get('reasoning_content') else '无'}")
    print(f"  回复: {(msg.get('content') or '')[:100]}")

    print("\n  --- b: thinking enabled + reasoning_effort=high ---")
    body["thinking"] = {"type": "enabled"}
    body["reasoning_effort"] = "high"
    resp = req("chat/completions", body)
    msg = resp["choices"][0]["message"]
    print(f"  reasoning_content: {'有' if msg.get('reasoning_content') else '无'}")
    assert msg.get("reasoning_content")
    print("  ✅ 通过")

    print("\n  --- c: thinking disabled ---")
    body2 = {"model": MODEL, "messages": [{"role": "user", "content": "test"}],
             "thinking": {"type": "disabled"}, "stream": False}
    resp2 = req("chat/completions", body2)
    msg2 = resp2["choices"][0]["message"]
    assert not msg2.get("reasoning_content")
    print("  ✅ 通过")

    print("\n  --- d: reasoning_effort=max ---")
    body3 = {"model": MODEL, "messages": [{"role": "user", "content": "请解方程: 2x + 5 = 15，一步步思考"}],
             "thinking": {"type": "enabled"}, "reasoning_effort": "max", "stream": False}
    resp3 = req("chat/completions", body3)
    rc3 = resp3["choices"][0]["message"].get("reasoning_content", "")
    print(f"  思考过程长度: {len(rc3)} chars")
    assert rc3
    print("  ✅ 通过")


def test_multi_turn():
    section("多轮对话")
    messages = [
        {"role": "system", "content": "你是一个助手"},
        {"role": "user", "content": "我的名字是小明"},
    ]
    body = {"model": MODEL, "messages": messages, "stream": False}
    t0 = time.time()
    resp = req("chat/completions", body)
    first_msg = resp["choices"][0]["message"]
    messages.append({"role": "assistant", "content": first_msg["content"]})
    messages.append({"role": "user", "content": "我叫什么名字？"})
    body["messages"] = messages
    resp2 = req("chat/completions", body)
    content = resp2["choices"][0]["message"].get("content", "")
    print(f"  回复: {content[:200]}")
    assert "小明" in content
    print("  ✅ 通过")


def test_error_handling():
    section("错误处理")
    body = {
        "model": "nonexistent-model",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False,
    }
    try:
        req("chat/completions", body)
        print("  ❌ 预期会报错，但请求成功")
    except Exception as e:
        print(f"  错误正常: {str(e)[:200]}")
        print("  ✅ 通过")


if __name__ == "__main__":
    print(f"DeepSeek 官方 API 测试套件")
    print(f"  API: {BASE_URL}")
    print(f"  模型: {MODEL}")
    print(f"  时间: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    tests = [
        ("基础非流式对话", test_basic_chat),
        ("流式对话", test_streaming_chat),
        ("工具调用", test_tool_call),
        ("工具调用闭环", test_tool_call_with_result),
        ("JSON 输出模式", test_json_mode),
        ("思考模式", test_thinking_mode),
        ("多轮对话", test_multi_turn),
        ("错误处理", test_error_handling),
    ]

    passed = 0
    failed = 0
    for name, func in tests:
        try:
            func()
            passed += 1
        except Exception as e:
            print(f"  ❌ 失败: {e}")
            failed += 1
        print()

    print(f"{'=' * 60}")
    print(f"  测试完成: {passed} 通过, {failed} 失败 / {len(tests)} 总计")
    print(f"{'=' * 60}")
