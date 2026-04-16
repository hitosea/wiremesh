---
name: release
description: Use when user wants to release a new version, publish a version, bump the version, ship a release, or "发版/发布版本/发个版本". Reads current version, proposes next, then bumps package.json, commits, and pushes.
---

# Release Version

发布 WireMesh 新版本。版本号只存在于根目录 `package.json`，发版流程就是改版本号 + 提交 + 推送。

## 流程

1. **检查工作区干净**：先跑 `git status --porcelain`。
   - **有未提交的改动** → 停下来，把 `git status` 的结果列给用户，询问是先提交/丢弃/stash 还是取消发版。**不要替用户 `git add` 一把梭**，也不要把这些无关改动夹带进 version bump 提交里。用户明确说"都一起提交"之后再继续。
   - **干净** → 继续下一步。
   - 同时确认在 `main` 分支上（不是就问用户是否切换）。
2. **读取当前版本**：`package.json` 的 `version` 字段。
3. **建议下一个版本**：默认建议 **patch** 递增（`1.0.4 → 1.0.5`），同时列出 minor / major 选项供用户选择。遵循 SemVer：
   - patch：bug 修复、文档、小调整
   - minor：新增功能（向后兼容）
   - major：破坏性变更
4. **等用户确认**：用 `<options>` 列出候选版本号，第一项为推荐项。**必须等用户选定后再动手**。
5. **实施**：
   - 修改 `package.json` 的 `version` 字段（只改这一处）。
   - `git add package.json`
   - `git commit -m "chore: bump version to X.Y.Z"`（保持与历史一致，不加 Co-Authored-By，不加其他 body）
   - `git push`
6. **汇报**：一句话告诉用户发布完成，附新版本号。

## 注意事项

- **只改 `package.json`**。不要去找 `CHANGELOG`、`src/` 里的版本常量、Agent 版本之类的东西 —— 本项目的版本号唯一来源就是根 `package.json`。
- **commit 消息用英文**，格式固定：`chore: bump version to X.Y.Z`（参考 `90e8838`、`2a5831d` 等历史提交）。
- **不加 Co-Authored-By 尾注**，历史版本提交都没有。
- **不要在 push 前跑 lint / test / build**，用户要的是快速发版。如有 pre-commit hook 失败，照常排查原因，不要 `--no-verify`。
- **推荐版本号的判断依据**：如果最近提交里全是 `fix:` / `chore:` / `docs:`，推 patch；出现 `feat:` 推 minor；用户另行说明则以用户为准。可以快速看一眼 `git log <last-tag>..HEAD` 或最近几条 commit 辅助判断，但不要过度分析。

## 询问用户确认的模板

```
当前版本：X.Y.Z
建议下一版：X.Y.(Z+1)（理由：最近都是 fix/chore）

<options>
  <option>X.Y.(Z+1) — patch</option>
  <option>X.(Y+1).0 — minor</option>
  <option>(X+1).0.0 — major</option>
</options>
```

## 完成后

回复形如：`已发布 vX.Y.Z，已推送到 origin/main。` 不需要总结改动，不需要列步骤。
