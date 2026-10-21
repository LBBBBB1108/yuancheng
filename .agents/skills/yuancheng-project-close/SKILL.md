---
name: yuancheng-project-close
description: Use when formally closing completed work in the yuancheng Windows remote-assistance project, especially before a local commit or an explicitly requested push to main.
---

# 远程协助项目收尾

用于完成 `yuancheng` 当前工作的正式收尾：验证实际成果、更新状态、检查敏感信息并创建准确的本地提交。它不新增功能，也不自动部署。

项目目录：`C:\Users\Administrator\Desktop\远程项目`

正式分支：`main`

状态文件：`state.md`

开始收尾后直接执行。仅在测试失败、发现敏感信息或来源不明修改、存在严重冲突，或推送可能触发未获授权的 Render 部署时暂停并报告。

## 收尾流程

1. 检查当前分支与正式修改：

   ```powershell
   git branch --show-current
   git status --short
   git diff --check
   git diff --stat
   ```

   发现来源不明修改时停止；不要合并、丢弃或覆盖。

2. 运行当前任务需要的完整测试和构建。失败时停止，不得把未验证内容记录为完成。

3. 只清理能确认由当前任务生成的临时文件。禁止使用 `git clean -fd`、`git reset --hard` 或其他可能破坏用户工作的命令。

4. 检查待提交文件，不得提交 `.env`、数据库连接串、API Key、Token、密码、设备私钥、证书私钥或其他敏感数据。发现后立即停止。

5. 更新根目录 `state.md`，如实记录当前阶段、本轮完成、未完成、已知问题、测试结果和下次继续位置。仅当 `docs/handoff.md` 已存在时同步更新它。

6. 再次运行：

   ```powershell
   git status --short
   git diff --check
   ```

   只添加本轮正式文件并创建描述准确的本地提交；没有正式修改时不创建空提交。

7. 本地提交后检查工作区。只有用户在本轮明确要求推送，且确认不会触发未经授权的 Render 部署时，才能推送 `main`；否则停在本地提交。

8. 除非用户明确要求，禁止创建或修改 Render 服务、数据库、环境变量、付费资源和部署。

## 中文汇报格式

```text
远程协助项目收尾：完成 / 暂停
项目状态文档：已更新 / 未更新
测试与构建：通过 / 失败 / 未执行
临时文件：已处理 / 无需处理
敏感信息：未发现 / 已发现并停止
Git commit：已完成 / 无正式修改 / 未执行
Git push：已完成 / 未授权 / 未执行
GitHub：已同步 / 未同步
工作区：干净 / 有未提交修改
Render：未配置、未部署 / 按明确指令执行
下次继续位置：……
```

完成或暂停后停止，不继续开发，不自动部署。
