# Covalo 硬改名实施 Spec

## 0. 目标

将当前项目彻底改名为 **Covalo**。

本次不是兼容迁移，而是硬改名。不考虑旧用户，不保留旧入口，不保留旧环境变量，不保留旧目录，不保留旧 schema 字符串。最终代码、主文档、package metadata、CLI、默认行为、测试、CI、release 配置中都不应再出现旧名称。

新名称固定为：

```text
Display name: Covalo
CLI command: covalo
NPM package name: covalo
Workspace scope: @covalo/*
Local state dir: .covalo
Environment prefix: COVALO_
GitHub repo: bzcsk2/covalo
Repository directory: covalo
Packet schema prefix: covalo.
```

必须移除的旧名称包括：

```text
LoopRig
looprig
LOOPRIG
DeepReef
deepreef
DEEPREEF
DEEPRREF
@deepreef/*
.looprig
.deepreef
```

说明：本文件作为实施计划会临时包含旧名称。最终合并前，若要求全仓库零旧名，本文件也应删除，或改写成不含旧名称的完成记录。

---

## 1. 硬性原则

### 1.1 不保留兼容入口

禁止保留：

```text
旧 CLI alias
旧 npm package wrapper
旧 workspace scope
旧 local state dir 读取逻辑
旧 environment variable 读取逻辑
旧 packet schema allowlist
旧 GitHub URL
旧仓库目录路径
```

最终只接受：

```text
covalo
@covalo/*
.covalo
COVALO_*
covalo.*
github.com/bzcsk2/covalo
```

### 1.2 不做软迁移

以下策略不适用于本次改名：

```text
保留旧 CLI alias 一个版本
保留旧 env warning
旧目录 fallback
旧 schema 继续可读
旧包 wrapper
旧 artifact 兼容
```

如果测试依赖旧名称，应更新测试数据或删除旧兼容测试。不要为了让旧测试继续通过而保留旧名称。

### 1.3 不做无关重构

允许为改名调整必要结构，但不要趁机重写核心行为：

```text
不要重写 runner / verifier / scoring 主逻辑
不要改 eval fixture 业务逻辑
不要引入网络下载
不要改变 trace.jsonl / observability.jsonl 等技术文件名，除非文件名含旧品牌
不要改变无品牌含义的通用术语
```

---

## 2. 最终命名规则

### 2.1 Package

根 `package.json`：

```json
{
  "name": "covalo",
  "description": "A dual-role agent harness for traceable loop engineering, evals, weak-model supervision, and self-improving agent workflows.",
  "bin": {
    "covalo": "./dist/index.js"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/bzcsk2/covalo.git"
  },
  "bugs": {
    "url": "https://github.com/bzcsk2/covalo/issues"
  },
  "homepage": "https://github.com/bzcsk2/covalo#readme"
}
```

所有 workspace 包名改为 `@covalo/*`，例如：

```text
@covalo/cli
@covalo/core
@covalo/tools
@covalo/tui
@covalo/mcp
@covalo/memory
@covalo/plugin
@covalo/security
@covalo/shell
@covalo/ink
```

所有 import、dependencies、lockfile 必须同步。

### 2.2 CLI

最终只暴露：

```bash
covalo
```

`package.json` 中不得包含旧 bin key。CLI help、banner、usage、错误信息、示例命令只使用 `Covalo` / `covalo`。

### 2.3 Local State

最终只使用：

```text
.covalo
```

所有默认写入、读取、测试 fixture、文档示例都必须改为 `.covalo`。不得读取旧目录作为 fallback。

### 2.4 Environment Variables

最终只使用：

```text
COVALO_ROOT
COVALO_LOG_LEVEL
COVALO_LOG_FILE
COVALO_LOG_FILTER
COVALO_LOG_SYMLINK
COVALO_EVAL_ASSETS_DIR
```

项目中如还有其他品牌前缀环境变量，也一律改为 `COVALO_`。不得保留旧变量读取、deprecated warning、suppress warning。

### 2.5 Packet / Harness Schema

所有项目自有 schema prefix 改为：

```text
covalo.
```

例如：

```text
covalo.task-digest.v1
covalo.runtime-guard.v1
covalo.action-certificate.v1
covalo.review-packet.v1
covalo.incident-packet.v1
covalo.recovery-packet.v1
covalo.harness-patch.v1
covalo.harness-lineage.v1
covalo.packet-base.v1
```

不得继续接受旧 schema allowlist。旧 artifact 不作为本次验收目标。

### 2.6 Repository

目标 GitHub repo：

```text
bzcsk2/covalo
```

目标本地目录：

```text
/vol4/Agent/covalo
```

活跃文档、测试、脚本不得硬编码旧仓库名或旧绝对路径。

---

## 3. 阶段门禁

必须按阶段执行。每个阶段测试通过后，才能开始下一阶段。

阶段结束必须汇报：

```text
1. 本阶段改了哪些文件
2. 运行了哪些命令
3. 哪些测试通过
4. 哪些测试未运行以及原因
5. 是否发现旧名称残留
6. 是否 PASS，可以进入下一阶段
```

如果阶段测试失败，必须先修复，不得继续推进。

---

## 4. Phase 0: Inventory and Baseline

目标：只盘点，不改代码。

必须执行：

```bash
rg -n "LoopRig|looprig|LOOPRIG|DeepReef|deepreef|DEEPREEF|DEEPRREF|@deepreef|\\.looprig|\\.deepreef" .
find .. -maxdepth 2 \( -type d -name looprig -o -type d -name covalo \)
git remote -v
bun run typecheck
bun run build
npm pack --dry-run
```

输出要求：

```text
旧名称命中按类别归档：
A. package metadata
B. workspace import
C. CLI / help / banner
D. env var
E. local state dir
F. packet schema
G. tests
H. docs
I. CI / release
J. repository URL / absolute path
```

进入下一阶段条件：baseline 清楚，现有失败已记录。

---

## 5. Phase 1: Package, Workspace, and Imports

目标：先让包名、workspace scope、import 图彻底变成 Covalo。

允许修改：

```text
package.json
packages/*/package.json
npm-placeholders/**
bun.lock
pnpm-lock.yaml
tsconfig / build config，如受包名影响
所有 @deepreef/* imports
```

必须实现：

```text
根包 name 为 covalo
所有 workspace package 为 @covalo/*
所有 workspace dependency 为 @covalo/*
所有 source import 为 @covalo/*
lockfile 不再含 @deepreef
```

必须测试：

```bash
bun install
bun run typecheck
bun run build
rg -n "@deepreef|DeepReef|deepreef|DEEPREEF|DEEPRREF" package.json packages npm-placeholders bun.lock pnpm-lock.yaml
```

进入下一阶段条件：package/import/lockfile 无旧名称残留，typecheck 和 build 通过。

---

## 6. Phase 2: CLI Rename

目标：CLI 只剩 `covalo`。

允许修改：

```text
root package bin
packages/cli/**
packages/tui/**
CLI tests
README command examples，如测试需要
```

必须实现：

```text
bin 只包含 covalo
help 只展示 Covalo / covalo
usage examples 只使用 covalo
代码中不再存在旧 CLI alias
```

必须测试：

```bash
bun run build
node ./dist/index.js --help
node ./dist/index.js eval doctor
rg -n "LoopRig|looprig|DeepReef|deepreef" packages/cli packages/tui dist package.json
```

进入下一阶段条件：CLI 主路径无旧名，`covalo --help` 和 `covalo eval doctor` 等价 smoke 通过。

---

## 7. Phase 3: Env and Local State Paths

目标：环境变量和本地状态目录只使用 `COVALO_` 和 `.covalo`。

允许修改：

```text
config / env resolver
runtime logger
eval assets resolver
eval run output root
memory default root
mcp/plugin/tools config path
tests
```

必须实现：

```text
默认 root 为 .covalo
eval 默认写 .covalo/evals
runtime logs 默认写 .covalo/logs
eval assets 只读 COVALO_EVAL_ASSETS_DIR
不读取旧 env
不读取旧 local state dir
不输出 deprecated warning
```

必须测试：

```bash
bun test packages/core packages/tools packages/cli packages/security
bun test packages/core/src/eval
bun run typecheck
rg -n "LOOPRIG|DEEPREEF|DEEPRREF|\\.looprig|\\.deepreef" packages scripts README.md README.zh.md docs
```

进入下一阶段条件：代码和测试不再依赖旧 env / 旧目录。

---

## 8. Phase 4: Packet, Harness, Eval Schema

目标：项目自有 schema 全部改成 `covalo.*`。

允许修改：

```text
packages/core/src/harness-evolution/**
packages/core/src/eval/**
packet / report tests
eval fixtures，如 fixture 内含旧品牌 schema
```

必须实现：

```text
所有 schemaVersion 使用 covalo.*
所有 allowlist 只接受 covalo.*
eval report 标题使用 Covalo
旧 schema 测试删除或改为 covalo.*
```

不得保留旧 schema 兼容。

必须测试：

```bash
bun test packages/core/__tests__/harness-evolution.test.ts
bun test packages/core/__tests__/harness-evolution-weakness-miner.test.ts
bun test packages/core/__tests__/harness-evolution-validator.test.ts
bun test packages/core/src/eval
bun run eval:assets:verify
bun run eval:assets:size
rg -n "looprig\\.|LoopRig|looprig" packages/core
```

进入下一阶段条件：schema、report、harness、eval 不再含旧品牌。

---

## 9. Phase 5: Docs, README, GitHub, CI, Release

目标：所有用户可见文档和 release 配置只使用 Covalo。

允许修改：

```text
README.md
README.zh.md
CONTRIBUTING.md
CHANGELOG.md 当前未发布部分
docs/**
.github/**
release scripts
CI workflow names
install / clone commands
repository URLs
```

历史 changelog 如果必须保留事实，可以移出发布包或改写成“pre-Covalo history”。若项目目标是全仓库零旧名，则历史文档也必须改写或删除。

必须测试：

```bash
rg -n "LoopRig|looprig|LOOPRIG|DeepReef|deepreef|DEEPREEF|DEEPRREF|@deepreef|\\.looprig|\\.deepreef" README.md README.zh.md CONTRIBUTING.md CHANGELOG.md docs .github package.json
bun run typecheck
bun run build
```

进入下一阶段条件：用户可见文档、GitHub URL、CI/release 配置无旧名称残留。

---

## 10. Phase 6: Repository Directory Rename Readiness

目标：准备将本地目录从旧目录名改为 `covalo`，并准备 GitHub repo 改名。

必须处理：

```text
所有 clone command 指向 bzcsk2/covalo
所有 repo URL 指向 bzcsk2/covalo
所有 active path 不再写旧目录名
package metadata 指向 bzcsk2/covalo
```

必须测试：

```bash
rg -n "github.com/.*/looprig|/vol4/Agent/looprig|cd looprig|git clone .*looprig|\\blooprig/" README.md README.zh.md docs package.json packages scripts .github
bun run typecheck
bun run build
```

进入下一阶段条件：代码和活跃文档已经可以在 `/vol4/Agent/covalo` 下运行。

目录改名本身建议在代码改动验证完成后执行：

```bash
cd /vol4/Agent
mv looprig covalo
cd covalo
bun run typecheck
bun run build
```

如果当前环境不适合直接移动目录，agent 必须明确说明“代码已准备好，目录尚未移动”。

---

## 11. Phase 7: Full Test and Pack Smoke

目标：确认新名字下可构建、测试、打包、安装。

必须测试：

```bash
bun run typecheck
bun test packages/core packages/tools packages/tui packages/cli packages/security
bun test packages/core/src/eval
bun run eval:assets:verify
bun run eval:assets:size
bun run build
npm pack --dry-run
npm pack
```

安装 smoke：

```bash
tmpdir="$(mktemp -d)"
pkg="$(pwd)"/covalo-*.tgz
cd "$tmpdir"
npm install "$pkg"
node node_modules/covalo/dist/index.js --help
node node_modules/covalo/dist/index.js eval doctor
```

进入下一阶段条件：npm pack 内容为 `covalo`，安装后只暴露 `covalo`。

---

## 12. Phase 8: Final Zero-Legacy Audit

目标：最终确认旧名称零残留。

必须执行：

```bash
rg -n "LoopRig|looprig|LOOPRIG|DeepReef|deepreef|DEEPREEF|DEEPRREF|@deepreef|\\.looprig|\\.deepreef" .
git status --short
bun run typecheck
bun run build
npm pack --dry-run
```

验收标准：

```text
1. 除本实施文件外，搜索结果必须为空。
2. 若要求全仓库零旧名，本实施文件也必须删除或改写。
3. package tarball 中不得包含旧名称。
4. dist 输出中不得包含旧名称。
5. CLI 只暴露 covalo。
6. schema 只使用 covalo.*。
7. env 只使用 COVALO_*。
8. local state 只使用 .covalo。
```

如果 `rg` 仍有命中，不能交付，必须继续清理。

---

## 13. 禁止事项

禁止：

```text
1. 保留旧 CLI alias。
2. 保留旧 env fallback。
3. 保留旧目录 fallback。
4. 保留旧 schema allowlist。
5. 创建旧 npm wrapper。
6. 在 README 或 CLI help 中提旧名称。
7. 在 tests 中继续断言旧名称。
8. 在 lockfile 中保留旧 workspace scope。
9. 在 GitHub URL 中保留旧 repo 名。
10. 在 active scripts/docs 中硬编码旧本地目录。
```

---

## 14. 最终交付物

agent 完成后应提交：

```text
1. 代码改动
2. README.md / README.zh.md 更新
3. package metadata 更新
4. workspace scope 和 imports 更新
5. CLI 只剩 covalo
6. COVALO_* env 和 .covalo state path
7. covalo.* schema
8. GitHub repo metadata 指向 bzcsk2/covalo
9. 新增/更新测试
10. full zero-legacy audit 输出
11. 验证命令输出摘要
12. 是否已移动本地目录到 /vol4/Agent/covalo
13. 是否已准备好改 GitHub repo 名
14. 是否已准备好发布 npm 包 covalo
```

最终回复必须包含：

```text
- 改了哪些命名入口
- 是否还有旧名称残留；如果有，为什么尚未清理
- 跑了哪些测试
- 哪些测试未能运行，原因是什么
- 本地目录是否已经或可以改名为 covalo
- GitHub repo 是否可以改名为 bzcsk2/covalo
- npm 包是否可以发布为 covalo
```

---

## 15. 验收结论模板

完成后使用以下格式汇报：

~~~~markdown
## Covalo hard rename result

### Summary

- Display name is `Covalo`.
- CLI command is only `covalo`.
- NPM package is `covalo`.
- Workspace packages use `@covalo/*`.
- Local state directory is `.covalo`.
- Environment variables use `COVALO_*`.
- Packet schemas use `covalo.*`.
- GitHub repo target is `bzcsk2/covalo`.
- Repository directory target is `covalo`.

### Validation

```bash
bun run typecheck
bun test packages/core packages/tools packages/tui packages/cli packages/security
bun test packages/core/src/eval
bun run eval:assets:verify
bun run eval:assets:size
bun run build
npm pack --dry-run
```

### Zero-Legacy Audit

```bash
rg -n "LoopRig|looprig|LOOPRIG|DeepReef|deepreef|DEEPREEF|DEEPRREF|@deepreef|\\.looprig|\\.deepreef" .
```

Result:

```text
No remaining old-name references, or only this implementation spec remains and should be removed before final merge.
```

### Recommendation

Ready / Not ready for local directory rename to `covalo`.
Ready / Not ready for GitHub repo rename to `bzcsk2/covalo`.
Ready / Not ready for npm publish as `covalo`.
~~~~
