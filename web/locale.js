const en={language:'Language',runs:'Runs',newRun:'New run',preset:'Preset',paper:'Paper Method',minute:'Hyperliquid Minute',model:'Model',thinking:'Reasoning',startDate:'Start · UTC',endDate:'End · UTC',horizon:'Horizon · minutes',seed:'Seed',generations:'Generations',concurrency:'Concurrency',run:'Run',queued:'Queued',running:'Running',pausing:'Pausing',paused:'Paused',completed:'Completed',failed:'Failed',stopped:'Stopped',pause:'Pause',resume:'Resume',stop:'Stop',export:'Export factors',generation:'Generation',candidates:'Candidates',lineage:'Lineage',artifacts:'Artifacts',code:'Code',diff:'Diff',reviews:'Reviews',coverage:'Coverage',assetCount:'Instruments',observedMinutes:'Observed minutes',expectedMinutes:'Expected minutes',rows:'Rows',candidate:'Candidate',operator:'Operator',parent:'Parents',status:'Status',qualified:'Qualified',elite:'Elite',plot:'Metrics',limit:'Generation limit',plateau:'Plateau',plateauWindow:'Plateau window · generations',empty:'No records',seedOp:'Seed',inject:'Injection',mutation:'Mutation',crossover:'Crossover',crossover_mutation:'Crossover + mutation',BAD_REQUEST:'Invalid input',INVALID_DATES:'Invalid UTC date range',MODEL_REQUIRED:'Select a model',MODEL_UNKNOWN:'Model unavailable',THINKING_UNSUPPORTED:'Reasoning level unavailable',MODEL_CREDENTIAL:'Model credential unavailable',SERVER_ERROR:'Server error',NOT_FOUND:'Not found',RUN_TERMINAL:'Run already ended',MODEL_UNANSWERED:'Model did not answer',MODEL_EMPTY:'Empty model response',MODEL_FORMAT:'Invalid model output',CANDIDATE_FAILED:'Candidate failed',CANDIDATE_INTERRUPTED:'Candidate interrupted',CODE_QUALITY:'Code quality',LOGIC:'Logic review',MISSING_VALUES:'Too many missing values',OUTPUT_ALIGNMENT:'Misaligned output',NON_FINITE:'Non-finite output',LOOKAHEAD:'Future data detected',FACTOR_INPUT:'Invalid candidate input',FACTOR_ENTRY:'Missing factor function',FACTOR_RUNTIME:'Factor execution failed',INSUFFICIENT_CROSS_SECTIONS:'Insufficient cross-sections',EVALUATION_FAILED:'Evaluation failed',SANDBOX_UNAVAILABLE:'Isolated executor unavailable',QUANT_WORKER_FAILED:'Quant worker failed',GENERATION_FAILED:'Generation failed',NO_BARS:'No matching bars'};
const zh={language:'语言',runs:'运行记录',newRun:'新建运行',preset:'预设',paper:'论文方法',minute:'Hyperliquid 分钟研究',model:'模型',thinking:'推理强度',startDate:'起始日期 · UTC',endDate:'结束日期 · UTC',horizon:'预测窗口 · 分钟',seed:'随机种子',generations:'代数',concurrency:'并发数',run:'运行',queued:'排队中',running:'运行中',pausing:'正在暂停',paused:'已暂停',completed:'已完成',failed:'失败',stopped:'已停止',pause:'暂停',resume:'继续',stop:'停止',export:'导出因子',generation:'代次',candidates:'候选',lineage:'谱系',artifacts:'产物',code:'代码',diff:'差异',reviews:'评审',coverage:'数据覆盖',assetCount:'标的数',observedMinutes:'实际分钟数',expectedMinutes:'预期分钟数',rows:'行数',candidate:'候选',operator:'算子',parent:'亲代',status:'状态',qualified:'合格',elite:'精英',plot:'指标',limit:'达到代数上限',plateau:'平台期',plateauWindow:'平台期窗口 · 代',empty:'暂无记录',seedOp:'初始生成',inject:'注入',mutation:'变异',crossover:'交叉',crossover_mutation:'交叉后变异',BAD_REQUEST:'输入无效',INVALID_DATES:'UTC 日期范围无效',MODEL_REQUIRED:'请选择模型',MODEL_UNKNOWN:'模型不可用',THINKING_UNSUPPORTED:'该模型不支持此推理强度',MODEL_CREDENTIAL:'模型凭证不可用',SERVER_ERROR:'服务错误',NOT_FOUND:'未找到',RUN_TERMINAL:'运行已结束',MODEL_UNANSWERED:'模型未应答',MODEL_EMPTY:'模型返回为空',MODEL_FORMAT:'模型输出格式错误',CANDIDATE_FAILED:'候选失败',CANDIDATE_INTERRUPTED:'候选中断',CODE_QUALITY:'代码质量未通过',LOGIC:'逻辑评审未通过',MISSING_VALUES:'缺失值过多',OUTPUT_ALIGNMENT:'输出未对齐',NON_FINITE:'存在非有限输出',LOOKAHEAD:'检测到未来信息',FACTOR_INPUT:'候选输入无效',FACTOR_ENTRY:'缺少因子函数',FACTOR_RUNTIME:'因子执行失败',INSUFFICIENT_CROSS_SECTIONS:'可用横截面不足',EVALUATION_FAILED:'评估失败',SANDBOX_UNAVAILABLE:'隔离执行环境不可用',QUANT_WORKER_FAILED:'量化进程失败',GENERATION_FAILED:'本代失败',NO_BARS:'没有匹配的 K 线'};
Object.assign(en,{
  modelSettings:'Model settings',modelApiKey:'OpenAI API key',connectModel:'Connect',
  disconnectModel:'Disconnect',refreshModels:'Refresh models',saveModelDefaults:'Save defaults',
  chatGPTStart:'Sign in with ChatGPT',chatGPTCancel:'Cancel sign-in',chatGPTDisconnect:'Disconnect ChatGPT',
  chatGPTOpen:'Open the sign-in page and enter this code:',chatGPTConnected:'ChatGPT connected',chatGPTFailed:'ChatGPT sign-in failed',
  modelConnected:'OpenAI connected',modelDisconnected:'OpenAI not connected',modelSaved:'Model defaults saved',
  speed:'Reasoning speed',providerDefault:'Provider default',MODEL_SETTINGS_LOCAL:'Open model settings on this computer',
  MODEL_KEY_INVALID:'The API key was rejected',MODEL_CONNECTION_FAILED:'Cannot connect to OpenAI',
  SPEED_UNSUPPORTED:'The selected model does not support this speed',
});
Object.assign(zh,{
  modelSettings:'模型设置',modelApiKey:'OpenAI API Key',connectModel:'连接',
  disconnectModel:'断开',refreshModels:'刷新模型',saveModelDefaults:'保存默认值',
  chatGPTStart:'登录 ChatGPT',chatGPTCancel:'取消登录',chatGPTDisconnect:'断开 ChatGPT',
  chatGPTOpen:'打开登录页面并输入此代码：',chatGPTConnected:'ChatGPT 已连接',chatGPTFailed:'ChatGPT 登录失败',
  modelConnected:'OpenAI 已连接',modelDisconnected:'OpenAI 未连接',modelSaved:'已保存默认模型设置',
  speed:'推理速度',providerDefault:'服务默认',MODEL_SETTINGS_LOCAL:'请在运行服务的本机打开模型设置',
  MODEL_KEY_INVALID:'API Key 无效或没有访问权限',MODEL_CONNECTION_FAILED:'无法连接 OpenAI',
  SPEED_UNSUPPORTED:'该模型不支持此推理速度',
});
Object.assign(en,{"strategyDelivery":"Strategy delivery","strategyToken":"Strategy access token","strategyBacktestTarget":"Backtest target","strategyBacktestStart":"Backtest start (UTC)","strategyBacktestEnd":"Backtest end (UTC)","strategyDeployTarget":"Deployment target","strategyBuild":"Generate and backtest","strategyBrief":"Strategy brief (optional)","strategyPackage":"Strategy package","strategyFills":"Filled orders","strategyBacktestMetrics":"Native backtest metrics","strategyDownload":"Download package","strategyPush":"Push inactive package","strategy_generating":"Generating","strategy_backtesting":"Backtesting","strategy_validated":"Backtest completed","strategy_failed":"Failed","strategy_pushing":"Pushing","strategy_staged":"Staged, not running","STRATEGY_AUTH_REQUIRED":"A strategy access token is required.","STRATEGY_TARGET_MISSING":"Target unavailable.","STRATEGY_RUN_INCOMPLETE":"Finish factor research first.","STRATEGY_NO_ELITES":"This run has no eligible elite factors.","STRATEGY_BACKTEST_DATES":"Choose a later, non-overlapping backtest window.","STRATEGY_ID_CONFLICT":"This request ID already has different settings.","STRATEGY_NOT_VALIDATED":"Complete a qualifying backtest before pushing.","STRATEGY_PLAN_INVALID":"The model returned an invalid strategy plan.","STRATEGY_BUILD_FAILED":"Strategy generation stopped.","STRATEGY_BACKTEST_FAILED":"The backtest target could not complete this job.","STRATEGY_PUSH_FAILED":"The deployment target could not stage the package.","STRATEGY_CONFIG_MISMATCH":"The package differs from the source or configuration that was backtested.","STRATEGY_NO_FILLS":"The backtest produced no executed orders.","STRATEGY_RECEIPT_INVALID":"The target returned an invalid receipt."});
Object.assign(zh,{"strategyDelivery":"策略交付","strategyToken":"策略访问令牌","strategyBacktestTarget":"回测实例","strategyBacktestStart":"回测开始日期（UTC）","strategyBacktestEnd":"回测结束日期（UTC）","strategyDeployTarget":"部署实例","strategyBuild":"生成并回测","strategyBrief":"策略要求（可选）","strategyPackage":"策略包","strategyFills":"有成交的订单数","strategyBacktestMetrics":"原生回测指标","strategyDownload":"下载策略包","strategyPush":"推送未启用策略","strategy_generating":"生成中","strategy_backtesting":"回测中","strategy_validated":"回测已完成","strategy_failed":"失败","strategy_pushing":"推送中","strategy_staged":"已就绪，未启动","STRATEGY_AUTH_REQUIRED":"需要策略访问令牌。","STRATEGY_TARGET_MISSING":"目标实例不可用。","STRATEGY_RUN_INCOMPLETE":"请先完成因子研究。","STRATEGY_NO_ELITES":"这次研究没有合格的精英因子。","STRATEGY_BACKTEST_DATES":"请选择更晚且不重叠的回测区间。","STRATEGY_ID_CONFLICT":"这个请求编号已用于不同的配置。","STRATEGY_NOT_VALIDATED":"请先完成符合条件的回测。","STRATEGY_PLAN_INVALID":"模型返回的策略不符合格式。","STRATEGY_BUILD_FAILED":"策略生成已中止。","STRATEGY_BACKTEST_FAILED":"回测实例未能完成本次任务。","STRATEGY_PUSH_FAILED":"部署实例未能接收策略包。","STRATEGY_CONFIG_MISMATCH":"策略源码或配置与回测记录不一致。","STRATEGY_NO_FILLS":"本次回测没有任何成交。","STRATEGY_RECEIPT_INVALID":"实例返回的凭据无效。"});
export const packs={'en':en,'zh-CN':zh};

Object.assign(en,{
  aiReview:'AI performance review',reviewHistory:'Review history',comparisonSnapshots:'Compare with other snapshots (up to 7)',
  dailyReview:'Daily review',manualReview:'Manual review',dailySchedule:'Runs daily at 08:00 Shanghai time for the previous calendar day.',
  reviewDay:'Trading date · Shanghai',nextDaily:'Next daily run · Shanghai',nextCheck:'Next check · Shanghai',lastDaily:'Last trading date checked',
  dailyStart:'Trading day starts · UTC',dailyEnd:'Trading day ends (exclusive) · UTC',makerFills:'Maker fills',takerFills:'Taker fills',
  dailyOpenCount:'Observed positions at day end',dailyOpenLong:'Observed longs at day end',dailyOpenShort:'Observed shorts at day end',
  dayCoverage:'Source coverage',dayCaptured:'A snapshot spans the trading day',dayPartial:'No single snapshot confirms the full trading day',
  daily_no_data:'No eligible snapshot for this day',daily_no_activity:'No activity for this day in the available snapshots',daily_model_unavailable:'Waiting for a configured model',daily_queued:'Submitted',daily_error:'Scheduler error',
  reviewObjective:'Review question (optional)',reviewPromptHint:'What would you like to understand? Include current parameters or portfolio weights if relevant.',
  startReview:'Start AI review',reviewReadOnly:'Start a review on the local host or through the CLI.',
  review_diagnosing:'Diagnosing performance',review_deciding:'Evaluating adjustments',review_completed:'Review complete',review_failed:'Review failed',
  reviewInputs:'Reviewed snapshots',reviewDiagnosis:'Performance diagnosis',reviewDecisions:'Adjustment decisions',sourceRecords:'Source records',
  reviewUncertainty:'Uncertainty',reviewNextStep:'How to verify',decision_strategy:'Strategy',decision_portfolio:'Portfolio',decision_parameters:'Parameters',
  decision_keep:'Keep',decision_adjust:'Adjust',decision_insufficient:'Insufficient information',strategyParameters:'Recorded strategy parameters',
  ref_snapshot:'Snapshot',ref_currency:'Currency results',ref_window:'Comparison window',ref_fees:'Commissions',ref_position:'Position',ref_fill:'Fill',ref_parameter:'Parameter',
  importSnapshot:'Set up publish_daily_performance on the NautilusTrader node to send snapshots automatically, or import an existing snapshot with the CLI.',
  snapshotStart:'Snapshot coverage starts · UTC',
  ref_instrument:'Instrument activity',showAllInstruments:'Show all instruments',
  noCommonWindow:'The recorded event ranges do not share an observation window.',fillCount:'Fills',openCount:'Open positions',
  PERFORMANCE_REPORT_MISSING:'A selected performance snapshot is unavailable.',PERFORMANCE_REVIEW_FAILED:'The review could not finish.',
  winCount:'Winning closes',worstClose:'Lowest close P&L',medianClose:'Lower median close P&L',bestClose:'Highest close P&L',
  beforeWindow:'Cumulative P&L before window',atWindowEnd:'Cumulative P&L through window end',feeCount:'Commissions in snapshot',
  minFee:'Lowest commission',medianFee:'Lower median commission',maxFee:'Highest commission',windowStart:'Common window start · UTC',windowEnd:'Common window end · UTC',
  windowFeeCount:'Commissions in window',windowMedianFee:'Lower median commission in window',windowMaxFee:'Highest commission in window',openSnapshot:'Open source snapshot',
  REVIEW_ID_CONFLICT:'This review ID belongs to a different request.',WEB_READ_ONLY:'Open this page on the local host or use the CLI to start a review.'
});
Object.assign(zh,{
  aiReview:'AI 绩效复盘',reviewHistory:'历史复盘',comparisonSnapshots:'加入对照快照（最多 7 份）',
  dailyReview:'每日自动复盘',manualReview:'手动复盘',dailySchedule:'每天北京时间 08:00 复盘上一个自然日。',
  reviewDay:'交易日 · 北京时间',nextDaily:'下次每日复盘 · 北京时间',nextCheck:'下次检查 · 北京时间',lastDaily:'最近检查的交易日',
  dailyStart:'交易日开始 · UTC',dailyEnd:'交易日结束（不含）· UTC',makerFills:'挂单成交笔数',takerFills:'吃单成交笔数',
  dailyOpenCount:'观测到的日末持仓数',dailyOpenLong:'观测到的日末多头持仓数',dailyOpenShort:'观测到的日末空头持仓数',
  dayCoverage:'快照覆盖范围',dayCaptured:'有快照覆盖整个交易日',dayPartial:'现有快照未能确认完整交易日',
  daily_no_data:'缺少当日可用快照',daily_no_activity:'现有快照中没有当日交易活动',daily_model_unavailable:'等待配置可用模型',daily_queued:'已提交',daily_error:'调度出错',
  reviewObjective:'复盘问题（可选）',reviewPromptHint:'你想了解什么？可补充当前策略参数或组合权重。',
  startReview:'开始 AI 复盘',reviewReadOnly:'可从本机页面或 CLI 发起复盘。',
  review_diagnosing:'正在诊断绩效',review_deciding:'正在评估调整方案',review_completed:'复盘完成',review_failed:'复盘失败',
  reviewInputs:'参与复盘的快照',reviewDiagnosis:'绩效诊断',reviewDecisions:'调整判断',sourceRecords:'原始记录',
  reviewUncertainty:'不确定性',reviewNextStep:'如何验证',decision_strategy:'策略',decision_portfolio:'组合',decision_parameters:'参数',
  decision_keep:'维持',decision_adjust:'建议调整',decision_insufficient:'信息不足',strategyParameters:'已记录的策略参数',
  ref_snapshot:'快照',ref_currency:'币种绩效',ref_window:'对照区间',ref_fees:'手续费',ref_position:'仓位',ref_fill:'成交',ref_parameter:'参数',
  importSnapshot:'在 NautilusTrader 节点接入 publish_daily_performance，即可自动上报快照。也可以用 CLI 导入已有快照。',
  snapshotStart:'快照采集起点 · UTC',
  ref_instrument:'标的交易活动',showAllInstruments:'查看全部标的',
  noCommonWindow:'所选快照没有共同的可观察事件区间。',fillCount:'成交笔数',openCount:'未平仓笔数',
  PERFORMANCE_REPORT_MISSING:'找不到本次复盘所选的快照。',PERFORMANCE_REVIEW_FAILED:'本次复盘未能完成。',
  winCount:'盈利平仓笔数',worstClose:'最低单笔平仓盈亏',medianClose:'单笔平仓盈亏下中位数',bestClose:'最高单笔平仓盈亏',
  beforeWindow:'区间开始前累计盈亏',atWindowEnd:'截至区间结束累计盈亏',feeCount:'快照内手续费笔数',
  minFee:'单笔最低手续费',medianFee:'单笔手续费下中位数',maxFee:'单笔最高手续费',windowStart:'共同比较起点 · UTC',windowEnd:'共同比较终点 · UTC',
  windowFeeCount:'区间内手续费笔数',windowMedianFee:'区间单笔手续费下中位数',windowMaxFee:'区间单笔最高手续费',openSnapshot:'查看来源快照',
  REVIEW_ID_CONFLICT:'此复盘编号已被另一项请求使用。',WEB_READ_ONLY:'请从本机页面或 CLI 发起复盘。'
});

Object.assign(en,{
  performance:'Performance',performanceTitle:'Performance & trade review',paperTrading:'Paper',liveTrading:'Live',
  tradingSession:'Report snapshot',refreshReports:'Refresh',noPaperReports:'No paper trading snapshots imported yet',noLiveReports:'No live trading snapshots imported yet',
  tradingStrategy:'Strategy',account:'Account',snapshotTime:'Snapshot time · UTC',nodeSession:'Node session',
  closedPerformance:'Closed-position performance',realizedNetPnl:'Closed-position P&L',realizedDrawdown:'Max realized drawdown',closedCount:'Closed positions',
  winRate:'Win rate',profitFactor:'Profit factor',fillFees:'Fill commissions',closedCurve:'Cumulative closed-position P&L',cumulativePnl:'Cumulative P&L',
  noClosedHistory:'No closed positions in this currency.',noCurrencyReport:'This snapshot has no per-currency results.',
  positionReview:'Position review',positionId:'Position ID',instrument:'Instrument',positionSide:'Position side',openedTime:'Opened · UTC',closedTime:'Closed · UTC',
  openQuantity:'Current quantity',peakQuantity:'Peak quantity',positionPnl:'Realized P&L',openPosition:'Open',fillsForPosition:'View fills for position',noPositions:'No positions in this snapshot.',
  executionReview:'Fill history',fillTime:'Filled · UTC',tradeSide:'Side',fillQuantity:'Fill quantity',fillPrice:'Fill price',currency:'Currency',
  commission:'Commission',liquidity:'Liquidity',orderId:'Order ID',tradeId:'Trade ID',noFills:'No matching fills in this snapshot.',allFills:'Show all fills',
  accountBalances:'Account balances · all strategies',totalBalance:'Total',freeBalance:'Free',lockedBalance:'Locked',noBalances:'No account balances in this snapshot.',
  newerRows:'Newer',olderRows:'Older',BUY:'Buy',SELL:'Sell',LONG:'Long',SHORT:'Short',FLAT:'Flat',MAKER:'Maker',TAKER:'Taker',NO_LIQUIDITY_SIDE:'Unspecified'
});
Object.assign(zh,{
  performance:'绩效复盘',performanceTitle:'绩效与交易复盘',paperTrading:'模拟盘',liveTrading:'实盘',
  tradingSession:'报告快照',refreshReports:'刷新',noPaperReports:'尚未导入模拟盘报告',noLiveReports:'尚未导入实盘报告',
  tradingStrategy:'策略',account:'账户',snapshotTime:'快照时间 · UTC',nodeSession:'节点会话',
  closedPerformance:'平仓绩效',realizedNetPnl:'已平仓盈亏',realizedDrawdown:'最大已实现回撤',closedCount:'已平仓笔数',
  winRate:'胜率',profitFactor:'毛利／毛损',fillFees:'成交手续费',closedCurve:'累计已平仓盈亏',cumulativePnl:'累计盈亏',
  noClosedHistory:'该币种暂无已平仓记录。',noCurrencyReport:'本次快照暂无分币种绩效。',
  positionReview:'持仓复盘',positionId:'仓位编号',instrument:'标的',positionSide:'仓位方向',openedTime:'开仓时间 · UTC',closedTime:'平仓时间 · UTC',
  openQuantity:'当前数量',peakQuantity:'峰值数量',positionPnl:'已实现盈亏',openPosition:'持仓中',fillsForPosition:'查看该仓位的成交',noPositions:'本次快照暂无持仓记录。',
  executionReview:'逐笔成交',fillTime:'成交时间 · UTC',tradeSide:'方向',fillQuantity:'成交数量',fillPrice:'成交价',currency:'币种',
  commission:'手续费',liquidity:'流动性',orderId:'订单编号',tradeId:'成交编号',noFills:'本次快照暂无匹配的成交。',allFills:'查看全部成交',
  accountBalances:'账户余额（所有策略）',totalBalance:'总余额',freeBalance:'可用',lockedBalance:'锁定',noBalances:'本次快照暂无账户余额。',
  newerRows:'较新',olderRows:'较早',BUY:'买入',SELL:'卖出',LONG:'多头',SHORT:'空头',FLAT:'已平仓',MAKER:'挂单',TAKER:'吃单',NO_LIQUIDITY_SIDE:'未指定'
});

Object.assign(en,{
  skip:'Skip to content',overview:'Overview',research:'Research',reports:'Research reports',report:'Research report',loading:'Loading',noReports:'No research reports yet',noGenerations:'No completed generations yet',noScores:'No score',activeRuns:'Active runs',created:'Created',direction:'Research direction',researchParameters:'Research parameters',generationProgress:'Generation progress',retainedParents:'Retained parents',chartData:'Chart data',qualifiedThreshold:'Qualification threshold',eliteThreshold:'Elite threshold',minScore:'Min',maxScore:'Max',scores:'Factor scores',feedback:'Generation feedback',hypothesis:'Hypothesis',formula:'Formula',testedPeriods:'Tested periods',miPeriods:'MI periods',missingValues:'Missing values',researchRole:'Research role',stage:'Stage',reason:'Reason',passed:'Passed',evaluated:'Evaluated',endExclusive:'End (exclusive) · UTC',sourceBars:'Source bars',firstBar:'First observed bar',lastBar:'Last observed bar',runStopReason:'Stop reason',runId:'Run ID',orders:'Orders',positions:'Positions',simulatedEvents:'Simulated events',pnl:'Profit and loss statistics',returns:'Return statistics',statistic:'Statistic',value:'Value',sourceFactors:'Source factors',deploymentReceipts:'Deployment receipts',instance:'Instance',defaultModel:'Default model',metric_ic:'IC',metric_rank_ic:'Rank IC',metric_icir:'ICIR',metric_rank_icir:'Rank ICIR',metric_mi:'Mutual information',
});
Object.assign(zh,{
  skip:'跳至内容',overview:'总览',research:'研究',reports:'研究报告',report:'研究报告',loading:'加载中',noReports:'暂无研究报告',noGenerations:'暂无已完成代次',noScores:'暂无评分',activeRuns:'进行中',created:'创建日期',direction:'研究方向',researchParameters:'研究参数',generationProgress:'代次进展',retainedParents:'保留亲代',chartData:'图表数据',qualifiedThreshold:'合格阈值',eliteThreshold:'精英阈值',minScore:'最低',maxScore:'最高',scores:'因子评分',feedback:'本代反馈',hypothesis:'假设',formula:'公式',testedPeriods:'评估期数',miPeriods:'互信息期数',missingValues:'缺失率',researchRole:'研究视角',stage:'阶段',reason:'原因',passed:'通过',evaluated:'已评估',endExclusive:'截至（不含）· UTC',sourceBars:'数据类型',firstBar:'首条行情',lastBar:'末条行情',runStopReason:'结束原因',runId:'运行编号',orders:'订单数',positions:'仓位数',simulatedEvents:'模拟事件数',pnl:'盈亏统计',returns:'收益统计',statistic:'统计项',value:'数值',sourceFactors:'来源因子',deploymentReceipts:'部署回执',instance:'实例',defaultModel:'默认模型',metric_ic:'IC',metric_rank_ic:'秩 IC',metric_icir:'ICIR',metric_rank_icir:'秩 ICIR',metric_mi:'互信息',
});
