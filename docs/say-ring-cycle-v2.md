# Say Ring 生理周期V2交接

客户端入口：我的，紧接健康提醒下方。独立账号数据；成年用户主动开启并确认用途，自动云同步；AI另行授权。未连接戒指也可记录。接口前缀为 /global/api/saydian-app/v2/health/cycle，JSON仍使用统一V2 envelope。

客户端请求必须携带与鉴权用户匹配的owner/ownerHash（sha256('saydian-health-owner:member:'+userId)）；这只是防会话切换竞态，不是认证。changes GET(cursor,owner)分页200，返回rows/cursor/hasMore/epoch。sync POST(ownerHash,offsetMinutes,epoch,rows)最多40项；行包含id/kind/data/deleted/baseRevision/mutationId。修订冲突返回原云行，由用户选取，不静默覆盖；mutationId与原载荷绑定。erase增加epoch，其他手机旧队列失效；删除标记不含经期/感受载荷，报告和重放副本一并删除。

period.data={start:YYYY-MM-DD,end?:YYYY-MM-DD}，daily.data={date,flow?,pain?,mood?,fatigue?,tags?}；settings的布尔项为enabled/adultConfirmed/purposeAccepted/recordOnly/historyComplete/hideSummary/remind/recordRemind，时间为leadDays(0..7)/hour(0..23)/minute(0..59)。不填与none不同。日期不能在未来，结束不早于开始，实际经期不可重叠；未结束要先确认结束。

prediction GET(offsetMinutes,owner)建立不可覆盖的calendar-v1快照；至少3完整周期/4真实开始日期，最近最多6周期min/max。参考过期不滚动。AI/explanation与night-features为独立路由；无合格数据不补零。旧报告包含sourceSequence、featureHash；新依据变化需重新生成。

## 迁移和部署

新增CycleState/Record/Mutation/Artifact和HealthRecord.sourceMetadata。SQL只新增，不改已有数值、设备绑定或原法律文档；生产迁移需在独立备份恢复/审查后执行。未执行迁移的线上仍不可用；不要把本地代码或单测当生产验收。回退应用代码时保留新表和数据，不执行DROP。

## AI准备

新专属文档类型say_ring_cycle_ai_analysis已可由后台选择；无自动seed或激活。需核对数据处理目的、外部供应商/地区、最小摘要、保留期限与撤回方式后，按既有审核发布流程发布该说明。现有Say Ring协议/隐私对和睡眠同意不改。

AI集成界面增加cycleAiEnabled（默认不开启）及cycleNoticeVersion。必须匹配当前已审说明；只接受既有明确允许的大陆供应商端点，不跟随重定向。首次分析由本人阅读当前完整文档并单独同意。模型只选审核过的action枚举，输出多余日期/数字/文本则降级固定模板。外发仅status、完整周期数和合格夜间统计类别/数量，无日期、真实身份、硬件编号、原始样本。提供商故障不影响记录/日历。

## 夜间数据与研究

source扩展可选vendor/deviceCategory/sourceApp/provenance/sleepWindows；旧缺失不补填。算法/温度语义未知即未知，SDK quality=0/有效样本不足排除。描述性特征采用真实主睡眠窗口>=4小时、至少4样本、预期覆盖>=70%、最大空档<=60分钟；这是保守工程筛选，不是医学标准。型号/固件/算法分组，不混SDNN/RMSSD；无明确接触状态时只标为描述性，enhancementEligible=false。

客户端tool/cycle_shadow_evaluation.py提供独立授权研究、参与者分组、时间泄漏检查、正则化离散风险率候选与按用户bootstrap；不会读取日常会员库或自动发布模型。RELEASED_CYCLE_MODELS当前为空，任何配置都不能让候选影响用户日期。20–30人连续3周期为可行性阶段，正式样本量与独立验收另行锁定。比较提前7/3天的MAE、范围覆盖/宽度、增强比例和全流水线回退表现；目标改善15%与分组证据未达标前不开放。

## 通知

普通日程，iOS日历触发，Android非精确AlarmManager（不索取精确闹钟权限）。锁屏泛化文案。每手机单独开启，修改/删除/账号切换取消；每日记录安排未来30天并在打开App时更新。Android重启/时区变化重建计划，不补发过期提醒。调度成功不等于实际送达；系统节电/权限/时区/后台验收分别记录。绝不调用红屏、报警音或戒指振动。
