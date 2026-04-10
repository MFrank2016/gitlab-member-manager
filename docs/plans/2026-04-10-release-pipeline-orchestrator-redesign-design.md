# 发布流水线编排器重构设计

日期：2026-04-10
状态：已确认（brainstorming 定稿）

## 1. 背景

当前仓库已经具备一版线性 Git 工作流能力：

- 工作流定义与变量
- 运行记录与步骤日志
- 取消与失败重试

但现有模型主要解决“按顺序执行本地 Git 步骤”，还不能覆盖新的发布场景：

- 自由创建多条发布流水线
- 手动运行与定时运行
- 先检查 GitLab 分支流水线状态，再决定是否继续
- 支持多项目之间的依赖与等待
- 在最后阶段触发指定 GitLab 流水线
- 失败时以中文给出明确原因、处理建议和证据

从可维护性和后续扩展性出发，本次不继续在现有 `workflow_*` 上叠补丁，而是将其升级为统一的 `pipeline_*` 流水线内核。

## 2. 目标

### 2.1 功能目标

- 支持自由创建多条发布流水线
- 支持手动运行与定时运行
- 支持流水线级变量，并在节点中以 `${variable}` 方式引用
- 支持内置可视化节点编排，不开放任意脚本执行
- 支持 GitLab 流水线检查、等待、触发
- 支持多项目发布链路中的顺序依赖和阶段性门禁
- 支持失败后生成新的派生重试运行
- 所有失败提示默认使用中文

### 2.2 非目标

- v1 不做任意 PowerShell/脚本执行
- v1 不做 DAG 图形编排器，仍采用线性有序节点列表
- v1 不做自动通知，由用户根据日志人工通知相关人员
- v1 不做系统服务化守护，定时运行依赖桌面应用保持打开
- v1 不做原地断点恢复，只做派生新运行

## 3. 核心决策

### 3.1 统一流水线内核

将现有工作流系统升级为统一的流水线内核，而不是新增一套平行的“发布模块”。

原因：

- 避免同时维护两套定义、两套执行器、两套运行记录
- 将现有 `checkout/pull/merge/push` 下沉为通用内置节点
- 后续新增 GitLab 节点、条件节点、等待节点时仍复用同一套运行时模型

### 3.2 编排方式

v1 使用“可视化编排 + 内置动作节点”。

原因：

- 能满足“自由创建流水线”的需求
- 比开放脚本执行更安全、更易校验
- 更容易做结构化失败原因和中文处理建议

### 3.3 变量模型

分支名、远程名等参数使用“流水线级变量”配置，不在节点中写死。

例如：

- `${feature_branch}`
- `${master_branch}`
- `${release_branch}`
- `${remote}`

原因：

- 同一条流水线可复用到不同发布场景
- 变量快照可直接保存在运行记录中，便于审计和重试

### 3.4 失败提示全部中文

后端统一输出结构化错误对象，前端默认展示中文标题、中文详情、中文处理建议。
底层英文 stderr、HTTP body、GitLab 原始响应仅作为“技术证据”保留。

### 3.5 重试策略

失败后不做原地恢复，统一生成新的派生运行。

支持：

- 重跑整条流水线
- 从失败节点重新开始
- 从指定节点重新开始

所有派生运行都保留 `source_run_id`，用于审计和追踪。

## 4. 系统架构

系统分为四层：

### 4.1 定义层

负责描述“应该如何运行”：

- 流水线定义
- 变量定义
- 节点定义
- 定时计划

### 4.2 运行层

负责描述“这次运行发生了什么”：

- 一次手动/定时运行
- 每个节点的状态变化
- 等待中的外部条件
- 中文失败结论与处理建议
- 运行输出上下文

### 4.3 能力层

封装实际执行能力：

- `GitAdapter`
- `GitLabAdapter`
- 后续预留 `NotifierAdapter`

### 4.4 交互层

负责用户界面：

- 流水线定义页
- 流水线运行页
- 项目资产页

## 5. 节点类型设计

### 5.1 原则

采用“原子节点 + 模板复用”，不直接设计大而全的复合节点。

原因：

- 节点职责清晰
- 扩展成本低
- 运行日志粒度清楚
- 失败定位更准确

### 5.2 首期内置节点

Git 本地节点：

- `git_checkout`
- `git_pull`
- `git_merge`
- `git_push`

GitLab 节点：

- `check_pipeline`
- `wait_pipeline`
- `trigger_pipeline`

控制节点：

- `sleep`
- `stop`

### 5.3 等待语义

`wait_pipeline` 优先等待“前一个相关节点刚产生的 commit 对应的流水线”，
而不是简单等待“某分支最新流水线”。

原因：

- 避免分支被其他人继续推送后误判状态
- 能精确对应当前自动化流程所触发的那一次变更

仅在“发版前检查 feature 分支当前是否健康”这类场景下，
才允许基于分支 HEAD 查询最新流水线状态。

## 6. 运行时状态机

### 6.1 流水线运行状态

`pipeline_run` 使用以下状态：

- `queued`
- `running`
- `waiting`
- `success`
- `failed`
- `cancelled`
- `interrupted`

### 6.2 节点运行状态

`pipeline_run_node` 使用以下状态：

- `pending`
- `running`
- `waiting`
- `success`
- `failed`
- `skipped`
- `cancelled`

### 6.3 等待节点要求

等待中的节点必须持久化以下信息：

- 当前等待目标（项目、分支、commit、pipeline）
- 最近一次查询结果
- 最近一次状态
- 下次轮询时间
- 已等待时长

这样前端才能准确展示“正在等待什么、为什么还没结束”。

## 7. 中文错误模型

### 7.1 结构

每个失败节点都使用统一结构化错误对象：

- `error_code`：稳定错误码
- `title_zh`：中文标题
- `detail_zh`：中文详情
- `suggestion_zh`：中文处理建议
- `evidence`：原始技术证据

### 7.2 示例错误码

- `仓库目录不存在`
- `工作区不干净`
- `分支不存在`
- `合并冲突`
- `推送被拒绝`
- `分支流水线失败`
- `分支流水线超时`
- `GitLab 认证失败`
- `GitLab 项目不存在`
- `GitLab 请求失败`

### 7.3 展示策略

界面默认展示：

- 为什么失败
- 建议怎么处理
- 与当前项目/分支/节点相关的上下文

技术证据单独折叠显示，包括：

- Git stdout/stderr
- HTTP 状态码
- GitLab 返回 body
- pipeline id
- commit sha
- 原始异常字符串

## 8. 定时运行设计

### 8.1 模型

一条流水线可挂多条定时计划，每条计划包含：

- 名称
- 启用状态
- 时区
- 执行规则
- 变量覆盖
- 并发策略

### 8.2 规则表达

v1 不直接开放完整 cron 文本，而是先做结构化规则：

- 每天
- 每周几
- 指定时间

原因：

- UI 更清楚
- 校验更简单
- 更适合业务用户使用

### 8.3 并发策略

每条计划支持以下策略：

- `skip_if_running`：已有运行时跳过
- `queue_after_running`：已有运行时排队
- `allow_parallel`：允许并行

默认推荐使用 `skip_if_running`。

### 8.4 运行限制

v1 的定时运行依赖桌面应用保持打开，不做系统级守护服务。

## 9. 数据模型

### 9.1 定义表

- `pipeline_definitions`
- `pipeline_variables`
- `pipeline_nodes`
- `pipeline_schedules`

### 9.2 运行表

- `pipeline_runs`
- `pipeline_run_nodes`

### 9.3 设计原则

- 数据库存储 JSON 配置
- Rust 代码中为每类节点提供强类型结构体和校验逻辑
- 所有运行记录只追加，不原地篡改历史

### 9.4 建议字段

`pipeline_definitions`

- `id`
- `name`
- `description`
- `enabled`
- `version`
- `created_at`
- `updated_at`

`pipeline_variables`

- `id`
- `pipeline_definition_id`
- `name`
- `default_value`
- `required_at_runtime`
- `sort_order`

`pipeline_nodes`

- `id`
- `pipeline_definition_id`
- `node_order`
- `node_type`
- `config_json`
- `timeout_seconds`
- `failure_policy`

`pipeline_schedules`

- `id`
- `pipeline_definition_id`
- `name`
- `enabled`
- `timezone`
- `schedule_kind`
- `schedule_config_json`
- `variable_overrides_json`
- `concurrency_policy`

`pipeline_runs`

- `id`
- `pipeline_definition_id`
- `trigger_kind`
- `status`
- `input_variables_json`
- `output_context_json`
- `source_run_id`
- `started_at`
- `finished_at`
- `created_at`
- `updated_at`

`pipeline_run_nodes`

- `id`
- `pipeline_run_id`
- `pipeline_node_id`
- `node_order`
- `node_type`
- `status`
- `rendered_config_json`
- `output_context_json`
- `error_json`
- `stdout`
- `stderr`
- `started_at`
- `finished_at`
- `updated_at`

## 10. 迁移策略

### 10.1 总体思路

采用“新增 + 映射 + 平滑下线”的方式：

1. 新增 `pipeline_*` 表与新执行器
2. 将旧 `workflow_*` 数据迁移映射到新模型
3. 保留旧表和旧数据至少一个版本周期
4. 新 UI 稳定后隐藏旧入口

### 10.2 旧数据映射

旧步骤与新节点的映射关系：

- `checkout_branch` -> `git_checkout`
- `git_pull` -> `git_pull`
- `git_merge` -> `git_merge`
- `git_push` -> `git_push`

旧变量定义迁移到 `pipeline_variables`。
旧运行历史迁移到 `pipeline_runs` 与 `pipeline_run_nodes`。

### 10.3 兼容原则

- 不删除已有历史
- 不要求用户手工重建旧工作流
- 新旧入口并存一个过渡周期

## 11. UI 结构

### 11.1 流水线定义页

采用左右布局：

- 左侧：流水线列表
- 右侧：详情编辑区

详情区分四个标签页：

- 基本信息
- 变量
- 节点
- 定时计划

### 11.2 流水线运行页

面向运维与排障场景，重点展示：

- 当前整体状态
- 节点时间线
- 正在等待的目标
- 中文失败结论
- 中文处理建议
- 技术证据

### 11.3 项目资产页

统一管理：

- GitLab 项目绑定
- 本地仓库路径
- 默认远程/默认分支

## 12. 测试策略

### 12.1 单元测试

覆盖：

- 变量渲染
- 节点配置校验
- 中文错误映射
- 定时规则解析
- 派生重试逻辑

### 12.2 执行器集成测试

使用临时 Git 仓库覆盖：

- 正常 checkout/pull/merge/push
- 工作区不干净
- 分支不存在
- 合并冲突
- push 被拒绝

### 12.3 GitLab 适配器测试

使用 mock HTTP 覆盖：

- 查询 pipeline 成功
- pipeline success / failed / running
- 超时
- 401 / 403
- 项目不存在

### 12.4 前端交互测试

覆盖：

- 节点编排
- 变量编辑
- 运行详情页
- 中文失败提示
- 从失败节点派生重试

## 13. 分阶段实施建议

### 13.1 一期

- 引入 `pipeline_*` 数据模型
- 构建新执行器骨架
- 完成旧 `workflow_*` 到新模型的迁移
- 保留现有 Git 节点能力

### 13.2 二期

- 增加 `check_pipeline`
- 增加 `wait_pipeline`
- 增加 `trigger_pipeline`
- 打通发布场景主链路

### 13.3 三期

- 增加定时运行
- 增强运行监控页
- 完善中文错误建议
- 支持从失败节点派生重试

## 14. 首期建议落地范围

优先实现以下能力：

- 新流水线定义/运行模型
- 旧 Git 工作流迁移
- GitLab 流水线检查/等待/触发
- 中文失败提示
- 手动运行
- 定时运行基础版

## 15. 后续动作

本设计定稿后，建议下一步进入 OpenSpec 提案阶段，创建新的变更提案，
再基于提案拆分实现计划与重构任务。
