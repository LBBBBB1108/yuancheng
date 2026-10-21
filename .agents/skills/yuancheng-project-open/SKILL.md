---
name: yuancheng-project-open
description: Use when starting or resuming work in the yuancheng Windows remote-assistance project and its recorded state must be restored before any development begins.
---

# 远程协助项目开启

用于恢复 `yuancheng` 项目现场。只核对记录和 Git 状态，不开发、不提交、不推送、不部署。

项目目录：`C:\Users\Administrator\Desktop\远程项目`

正式分支：`main`

状态文件：`state.md`

## 执行步骤

1. 读取 `state.md`；如果文件尚未创建，明确报告，不要自行创建。
2. 读取 `README.md`；仅当 `docs/handoff.md` 已存在时一并读取。
3. 在项目目录执行并检查：

   ```powershell
   git branch --show-current
   git status --short
   git log -1 --oneline
   git remote -v
   ```

4. 比较状态文件与 Git 事实。发现分支、提交或完成状态不一致时，以实际结果为准并明确标出，不自行修复。

## 中文汇报格式

```text
远程协助项目状态已恢复。

项目：yuancheng
分支：main
当前阶段：……
上次完成：……
未完成：……
Git 工作区：干净 / 有未提交修改
最近提交：……
下次继续位置：……

等待本轮任务。
```

## 禁止

- 扫描整个项目或读取与状态恢复无关的大量代码。
- 运行完整测试或重新审计历史。
- 修改代码、文档或 Git 状态。
- 执行 commit、push、Render 配置或部署。
