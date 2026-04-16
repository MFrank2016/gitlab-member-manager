# GitLab Member Manager 两个月演进路线图

**日期范围：** 2026-04-16 至 2026-06-15  
**适用范围：** 当前 `main` 分支上的 release pipeline orchestrator、pipeline scheduler、pipeline monitor、managed project / project group / member sync 能力  
**目标：** 在不扩大产品范围的前提下，把项目从“功能已可用”推进到“结构更稳、运行更顺、监控更清晰、后续更容易扩展”的状态。

---

## 1. 路线图目标

本轮两个月演进不追求继续快速堆功能，而是聚焦四个方向：

1. **可维护性**
   - 降低超大文件和双命名兼容层带来的维护成本
   - 让运行时、数据访问层、命令层、前端大页具备更清晰的边界
2. **交互体验**
   - 优化 pipeline 定义编辑器和运行监控页的使用流畅度
   - 减少依赖人工刷新、人工排查、人工记忆上下文
3. **性能**
   - 控制运行历史和运行详情在数据量变大后的查询成本
   - 优化 scheduler、run history、node detail 的加载策略
4. **可视化**
   - 从“表格 + 文本块”升级到更适合发布编排的运行视图
   - 让失败节点、等待态、调度状态、项目分布更容易看懂

---

## 2. 当前状态判断

当前版本已经完成了 pipeline schema、runtime、GitLab node、scheduler、monitoring UI 和 MSI 打包链路，功能上可以使用；但结构上已经进入明显的“演进债”阶段。

### 2.1 主要热点文件

- `src-tauri/src/workflows.rs`：5198 行
- `src-tauri/src/db.rs`：4866 行
- `src-tauri/src/main.rs`：1188 行
- `src/pages/WorkflowsPagePipeline.tsx`：1076 行
- `src/pages/WorkflowRunsPagePipeline.tsx`：451 行
- `src/lib/invoke.ts`：539 行
- `src/lib/types.ts`：376 行

### 2.2 当前最主要的结构问题

- **运行时职责过重**
  `workflows.rs` 同时承担模板渲染、Git 命令执行、GitLab 节点执行、失败包归类、取消/重试、scheduler 接线和测试。
- **数据访问层过重**
  `db.rs` 同时承担输入归一化、definition CRUD、run history 查询、migration、schedule 读写和测试。
- **命令层过厚**
  `main.rs` 当前是大规模命令注册和参数透传层，错误处理仍然以 `String` 为主，不利于前端做结构化恢复。
- **前端大页状态堆叠**
  pipeline definition editor 和 run monitor 已经成为大页状态机，组件边界不够清晰。
- **兼容层仍然存在**
  `workflow_*` 与 `pipeline_*` 双命名兼容层仍然带来接口面和认知负担。

### 2.3 当前最主要的运行/性能问题

- `list_pipeline_runs()` 当前是全量拉取运行历史，再在前端选择当前 run。
- `get_pipeline_run_detail()` 当前默认拉取项目、节点、等待元数据、日志字段。
- scheduler 目前是固定 30 秒 tick，每个 schedule 单独统计活跃 run。
- 前端外壳仍然是手写 tab 分发，未做页面级 lazy loading。

### 2.4 当前最主要的体验问题

- run monitor 主要依赖手动刷新。
- definition editor 仍有较多 JSON 文本编辑式操作，对普通用户不够友好。
- destructive 操作仍然偏向轻量确认，不够强调影响范围。
- 当前可视化仍然是“表格 + 详情块”，排查复杂 run 的速度有限。

---

## 3. 本轮演进的边界

### 3.1 本轮要做

- 拆分 Rust 运行时与数据访问层
- 定义更清晰的错误模型和运行状态模型
- 优化运行历史与运行详情的加载方式
- 优化 scheduler 的查询模式和用户可感知状态
- 提升 definition editor 和 run monitor 的交互体验
- 引入更适合 pipeline 的可视化视图

### 3.2 本轮不做

- 不引入“任意脚本节点”
- 不把桌面调度器升级为系统后台服务
- 不切换数据库或存储方案
- 不做全量重写式 UI 框架替换
- 不同时推进大范围新功能扩张

---

## 4. 总体策略

本轮按三段推进：

1. **结构治理优先**
   - 先拆热点文件和兼容层，降低继续开发成本
2. **运行体验次之**
   - 再做运行页自动刷新、分页、懒加载和调度器优化
3. **可视化最后**
   - 等数据和状态边界更稳定后，再做 DAG / 时间轴 / 矩阵视图

这是风险最可控、收益最大的顺序。  
如果反过来先做可视化，后面大概率会把旧结构再包一层新 UI，形成新的技术债。

---

## 5. 八周节奏

## 第 1 周（2026-04-16 至 2026-04-22）：基线与规划冻结

**目标：** 把两个月范围固定下来，建立后续验收所需的技术基线。

**主要工作：**

- 创建单独的 OpenSpec change，用于覆盖：
  - runtime 分层
  - run history 分页与详情懒加载
  - scheduler 优化
  - run monitor 自动刷新
  - pipeline 可视化增强
- 记录当前关键基线：
  - `list_pipeline_runs` 响应时间
  - `get_pipeline_run_detail` 响应时间
  - scheduler tick SQL 次数
  - 前端 run monitor 首次加载时间
- 固定非目标项，避免范围膨胀

**本周产出：**

- 一份正式设计文档
- 一份实施 checklist
- 一份基线指标记录

---

## 第 2 周（2026-04-23 至 2026-04-29）：拆分 Rust runtime

**目标：** 从 `workflows.rs` 中拆出清晰的运行时边界。

**建议拆分模块：**

- `pipeline_runtime`
- `workflow_runtime_legacy`
- `git_executor`
- `gitlab_executor`
- `failure_envelope`
- `retry_logic`

**主要工作：**

- 保持现有行为不变，只做结构重组
- 把 Git 节点、GitLab 节点、失败归类、等待态更新的逻辑分离
- 让 scheduler 和命令层只依赖公开入口，不直接碰内部细节

**本周产出：**

- `workflows.rs` 明显瘦身
- pipeline runtime 的核心边界清晰化
- 对应 focused tests 仍然全部通过

---

## 第 3 周（2026-04-30 至 2026-05-06）：收口命令层与错误模型

**目标：** 从“字符串错误”演进到“结构化错误”，让前端能做真正的状态区分。

**主要工作：**

- 为 Tauri 命令层定义统一的错误模型，例如：
  - `config_missing`
  - `validation_failed`
  - `git_failed`
  - `gitlab_failed`
  - `remote_waiting`
  - `not_found`
  - `conflict`
- 压缩 `main.rs` 的职责，让它变成薄入口
- 统一日志字段和错误返回结构

**用户收益：**

- 前端不再只能 `toast.error(String(error))`
- 可以针对错误类型做：
  - 行内提示
  - 恢复建议
  - 重试/跳转设置页
  - 更清晰的中文失败展示

---

## 第 4 周（2026-05-07 至 2026-05-13）：拆分前端 definition editor

**目标：** 让 pipeline 定义编辑器从“大表单组件”转为“可独立演进的组合式编辑器”。

**建议拆分：**

- `usePipelineDraft`
- `PipelineMetaForm`
- `VariableEditor`
- `NodeEditor`
- `ScheduleEditor`
- `PipelinePreviewPanel`

**主要工作：**

- 把 draft 构建、节点编辑、变量同步、schedule 编辑拆离
- 尽量减少 JSON 文本编辑场景
- 为 builtin node 增加更明确的字段编辑和即时校验
- 保留一个高级模式用于直接编辑原始参数 JSON

**用户收益：**

- 创建/修改 pipeline 更稳定
- 编辑复杂 pipeline 时不容易“全页状态一起崩”
- 后续新增节点类型时，不需要继续往单文件里堆逻辑

---

## 第 5 周（2026-05-14 至 2026-05-20）：运行历史性能优化

**目标：** 让运行历史在数据量增长后仍可流畅使用。

**主要工作：**

- 为 `list_pipeline_runs` 增加：
  - 分页
  - 状态过滤
  - pipeline 过滤
  - project group 过滤
  - 时间范围过滤
- 为 `get_pipeline_run_detail` 增加分层加载：
  - 先返回摘要和项目概览
  - 节点日志、evidence、stdout/stderr 按需加载
- 视情况补索引，例如：
  - `pipeline_runs(status, updated_at)`
  - `pipeline_runs(pipeline_definition_id, status)`
  - `pipeline_run_projects(status)`

**用户收益：**

- 历史多了以后列表不会先变卡
- 打开 run 详情更快
- 只有真正展开排障时才拉日志体积

---

## 第 6 周（2026-05-21 至 2026-05-27）：scheduler 与 run monitor 联动优化

**目标：** 让运行监控从“主要靠手动刷新”升级为“活跃 run 自动更新”。

**主要工作：**

- 优化 scheduler tick：
  - 尽量减少每个 schedule 单独查询活跃 run 的模式
  - 用聚合结果或缓存减轻数据库负担
- 为前端 run monitor 增加：
  - 仅对活跃 run 自动刷新
  - run 结束后自动停止刷新
  - 节点等待态自动更新
- 若实现成本可控，优先使用事件推送；否则采用定向轮询

**用户收益：**

- 用户不用不停点刷新
- GitLab `wait_pipeline` 节点状态更清晰
- scheduler 的行为更可理解

---

## 第 7 周（2026-05-28 至 2026-06-03）：可视化升级

**目标：** 用更适合 pipeline 的视图提升排障和理解效率。

**优先级建议：**

1. **运行 DAG 视图**
   - 展示节点顺序、等待节点、失败节点、远端 pipeline 节点
2. **项目 × 节点矩阵**
   - 纵向看项目，横向看节点
   - 一眼看出哪个项目卡在哪个节点
3. **时间轴视图**
   - 按时间展示开始、等待、远端状态变化、结束
4. **调度预览视图**
   - 展示未来 24 小时内的预期触发
   - 展示 skip / queue / parallel 策略的当前表现

**用户收益：**

- “看懂一次 run” 的时间显著下降
- 更适合复杂发布编排和多项目协同排障

---

## 第 8 周（2026-06-04 至 2026-06-10）：兼容层收口与整体硬化

**目标：** 为后续继续演进腾空间，而不是继续维护双轨结构。

**主要工作：**

- 把 `workflow_*` 兼容层进一步收口到最小范围
- 梳理：
  - `invoke.ts`
  - `types.ts`
  - workflow-named page re-export
  - legacy back-reference 字段的真实用途
- 补回归测试矩阵：
  - scheduler
  - runtime
  - retry
  - wait metadata
  - UI smoke
- 更新 README / docs / packaging notes

**用户收益：**

- 代码认知负担下降
- 后续新功能只沿 pipeline 语义继续演进

---

## 缓冲期（2026-06-11 至 2026-06-15）：收尾与风险兜底

**目标：** 消化延期项和回归问题，避免把路线图尾部做成新的风险堆积区。

**建议内容：**

- 修复第 5-8 周暴露的边角回归
- 复跑全量测试与打包
- 输出阶段性总结
- 如条件成熟，准备下一轮“兼容层退场 / pipeline-only surface”计划

---

## 6. 里程碑定义

### Milestone 1：结构止血

完成条件：

- Rust runtime 已拆分
- 命令层错误模型已结构化
- pipeline definition editor 已拆组件

### Milestone 2：运行体验升级

完成条件：

- run history 已分页
- detail 已支持懒加载
- 活跃 run 已自动刷新
- scheduler 查询模式已优化

### Milestone 3：编排可视化落地

完成条件：

- run DAG 已上线
- 时间轴或项目矩阵已上线
- schedule 预览已上线
- 兼容层已进一步收口

---

## 7. 验收标准

到 2026-06-15，建议以以下标准验收本轮演进：

### 7.1 可维护性

- 不再存在单个 5000 行级别的核心运行时文件
- `main.rs` 不再承担大规模命令业务逻辑
- pipeline 相关前端大页可按功能模块独立修改

### 7.2 交互体验

- 活跃 run 监控不再依赖用户高频手动刷新
- definition editor 支持更明确的字段级校验
- destructive 操作有统一的交互确认规范

### 7.3 性能

- run history 默认分页
- detail 首屏不拉全量日志
- scheduler tick 数据库压力低于当前实现

### 7.4 可视化

- 至少有一套真正适合 pipeline 的图形化运行视图上线
- 用户能够快速识别：
  - 哪个项目失败
  - 失败在哪个节点
  - 是否处于等待远端 pipeline
  - 下一次 schedule 何时触发

---

## 8. 风险与应对

### 风险 1：兼容层清理过快导致回归

**应对：**
- 先收口，再删除
- 所有 workflow-named surface 的退场都以测试和使用面收缩为前提

### 风险 2：可视化提前做，继续放大旧结构

**应对：**
- 严格按“结构治理 → 体验 → 可视化”的顺序推进

### 风险 3：运行时拆分过程中引入行为偏移

**应对：**
- 先保持行为不变，只做结构拆分
- focused Rust tests 每个阶段都必须稳定通过

### 风险 4：调度器优化牵出更多状态同步复杂度

**应对：**
- v1 继续保持桌面内存态 queue
- 不在本轮引入后台服务和 missed-run backfill

### 风险 5：MSI/WiX 自定义模板后续升级漂移

**应对：**
- 把 `src-tauri/wix/main.wxs` 视作正式维护资产
- 每次升级 Tauri bundler 时检查官方默认模板变化

---

## 9. 推荐的执行顺序

如果资源有限，这个顺序最值得坚持：

1. 拆 Rust runtime
2. 收口错误模型和命令层
3. 拆 definition editor
4. 做 run history 分页与 detail 懒加载
5. 做自动刷新和 scheduler 优化
6. 做 DAG / 时间轴 / 矩阵可视化
7. 收口兼容层

这也是本路线图最核心的判断：  
**先把“继续开发会越来越难”的问题解决，再去做“看起来更强”的那部分。**

---

## 10. 三个最值得先做的动作

如果只能优先做三件事，推荐：

1. **拆 `workflows.rs` 和 `db.rs`**
   - 这是所有后续优化的地基
2. **给 run history 做分页 + detail 懒加载**
   - 这是最直接的性能和体验收益点
3. **给活跃 run 做自动刷新**
   - 这是最直接的用户体感收益点

---

## 11. 下一步衔接建议

路线图确认后，建议紧接着做两件事：

1. 基于本路线图创建一个新的 OpenSpec change
2. 把第 1-2 周内容再细化成一份 grounded implementation plan

也就是说，当前这份文档用于“定方向”；下一份文档应该用于“开工执行”。

## Baseline Artifact

- See `docs/plans/2026-04-16-pipeline-baseline-metrics.md` for the verified pre-refactor command baseline and the current monitoring/query hotspots captured on 2026-04-16.
