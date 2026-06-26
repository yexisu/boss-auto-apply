// ==UserScript==
// @name         Liepin Auto Apply Helper (No AI)
// @namespace    local.liepin.auto.apply
// @version      0.3.3
// @description  Liepin web auto apply helper: foreign-company filter, outsource blocking, HR active filter, history duplicate check. No AI.
// @author       local
// @match        https://www.liepin.com/*
// @match        https://lpt.liepin.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'liepin_auto_apply_settings_v1';
  const HISTORY_KEY = 'liepin_auto_apply_history_v1';
  const HISTORY_MAX = 3000;
  const HISTORY_TTL = 1000 * 60 * 60 * 24 * 180;
  const EMPTY_SCROLL_STOP_BATCHES = 5;
  const JOB_LINK_PATTERN = /\/job\/|\/job-detail\/|\/job_detail\/|\/a\/|jobId=|positionId=|position_id=|job_id=/i;
  const SEARCH_PAGE_PATTERN = /\/zhaopin\//i;
  const JOB_CARD_SELECTOR = [
    '[data-job-id]', '[data-position-id]', '[data-jobid]', '[data-positionid]', '[data-job_id]', '[data-position_id]',
    '[class*=job-card]', '[class*=jobCard]', '[class*=job-list-item]', '[class*=jobListItem]', '[class*=job-item]', '[class*=jobItem]',
    '[class*=job-info-box]', '[class*=jobInfoBox]', '[class*=sojob-item]', '[class*=position-card]', '[class*=positionCard]',
    '.job-card', '.job-card-box', '.job-list-item', '.job-item', '.sojob-item-main', '.job-list-box > *', '.job-list-box > * > *'
  ].join(',');
  const APPLY_TEXT_PATTERN = /^(?:\u7acb\u5373)?(?:\u6295\u9012|\u5e94\u8058|\u7533\u8bf7)(?:\u7b80\u5386|\u804c\u4f4d|\u5c97\u4f4d)?$|^(?:\u7acb\u5373)?(?:\u6c9f\u901a|\u6c9f\u901aHR|\u5f00\u59cb\u6c9f\u901a|\u5728\u7ebf\u6c9f\u901a|\u7ee7\u7eed\u6c9f\u901a)$|^(?:\u7ee7\u7eed)?\u804a(?:\u4e00)?\u804a$|^(?:\u7acb\u5373)?\u8054\u7cfb(?:TA|HR|\u6211|\u5bf9\u65b9)?$|^\u6253\u62db\u547c$/i;
  const CONFIRM_TEXT_PATTERN = /^(?:\u786e\u5b9a|\u786e\u8ba4|\u786e\u8ba4\u6295\u9012|\u7acb\u5373\u6295\u9012|\u7ee7\u7eed\u6295\u9012|\u53d1\u9001|\u63d0\u4ea4|\u6211\u77e5\u9053\u4e86|\u4e86\u89e3|\u77e5\u9053\u4e86|\u6388\u6743|\u5141\u8bb8|\u5f00\u59cb\u6c9f\u901a)$/;
  const APPLIED_TEXT_PATTERN = /\u5df2\u6295\u9012|\u5df2\u7533\u8bf7|\u5df2\u5e94\u8058|\u5df2\u6c9f\u901a|\u7ee7\u7eed\u6c9f\u901a|\u7ee7\u7eed\u804a|\u6295\u9012\u6210\u529f|\u7533\u8bf7\u6210\u529f|\u53d1\u9001\u6210\u529f|\u5df2\u53d1\u9001/;
  const DISABLED_TEXT_PATTERN = /\u6682\u505c\u62db\u8058|\u505c\u6b62\u62db\u8058|\u804c\u4f4d\u5173\u95ed|\u5df2\u4e0b\u7ebf|\u4e0d\u53ef\u6295\u9012|\u5df2\u8fc7\u671f|\u6682\u65e0\u6743\u9650|\u4eca\u65e5\u5df2\u8fbe\u4e0a\u9650/;
  const BLOCK_REASONS = /\u9a8c\u8bc1|\u767b\u5f55|\u98ce\u63a7|\u9891\u7e41|\u4e0a\u9650|\u8bf7\u7a0d\u540e|\u5f02\u5e38\u6d41\u91cf|\u4eca\u65e5.*\u4e0a\u9650|captcha|verify|login/i;
  const OPEN_CHAT_API_PATTERN = /\/api\/com\.liepin\.im\.c\.chat\.open-chat/i;
  const CHAT_OPEN_TEXT_PATTERN = /\u804a\u4e00\u804a|\u7ee7\u7eed\u804a|\u53d1\u9001\u6d88\u606f|\u6c9f\u901a\u4e2d|\u5f00\u804a|\u804a\u5929|\u6d88\u606f/;
  const CHAT_BLOCK_TEXT_PATTERN = /\u5df2\u5c4f\u853d\u5f53\u524d\u516c\u53f8|\u89e3\u9664\u5c4f\u853d|\u7b80\u5386\u4e0d\u5b8c\u5584|\u7acb\u5373\u5b8c\u5584|\u5883\u5916\u6570\u636e\u8bbf\u95ee|\u767b\u5f55|\u9a8c\u8bc1|\u98ce\u63a7/;
  const SAFETY_TIP_PATTERN = /\u6c42\u804c\u8fc7\u7a0b|\u6536\u53d6\u57f9\u8bad\u8d39|\u8003\u8bc1\u8d39|\u4e2d\u4ecb\u8d39|\u62bc\u91d1|\u53d1\u5e03\u865a\u5047\u62db\u8058|\u7acb\u5373\u4e3e\u62a5/;
  const NEXT_PAGE_PATTERN = /^\s*(?:\u4e0b\u4e00\u9875|Next|>)\s*$/i;
  const ACTIVE_FIELD_PATTERN = /active|online|lastlogin|lastactive|hractive|hronline|recruiteractive|recruiteronline|\u6d3b\u8dc3|\u5728\u7ebf/i;
  const ACTIVE_TEXT_PATTERN = /(\u4e0d\u5728\u7ebf|\u79bb\u7ebf|\u4e0d\u6d3b\u8dc3|\u5f88\u4e45\u672a\u6d3b\u8dc3|\u521a\u521a\u5728\u7ebf|\u5f53\u524d\u5728\u7ebf|\u5728\u7ebf|\u521a\u521a\u6d3b\u8dc3|\u4eca\u65e5\u6d3b\u8dc3|\u4eca\u5929\u6d3b\u8dc3|\u8fd1\u671f\u6d3b\u8dc3|\u6700\u8fd1\u6d3b\u8dc3|\d+\s*(?:\u79d2|\u5206\u949f|\u5c0f\u65f6|\u5929|\u65e5|\u5468|\u6708|\u5e74)(?:\u524d|\u5185)?(?:\u6d3b\u8dc3|\u5728\u7ebf)?|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u4e24\u534a]+\s*(?:\u79d2|\u5206\u949f|\u5c0f\u65f6|\u5929|\u65e5|\u5468|\u6708|\u5e74)(?:\u524d|\u5185)?(?:\u6d3b\u8dc3|\u5728\u7ebf)?|\u672c\u5468\u6d3b\u8dc3|\u672c\u6708\u6d3b\u8dc3)/;

  const T = {
    panelTitle: '\u730e\u8058\u81ea\u52a8\u6295\u9012',
    collapse: '\u6536\u8d77/\u5c55\u5f00',
    maxApply: '\u6700\u5927\u6295\u9012\u6570',
    interval: '\u95f4\u9694\u79d2',
    autoLoadMore: '\u81ea\u52a8\u4e0b\u6ed1/\u7ffb\u9875',
    skipHistory: '\u8df3\u8fc7\u5386\u53f2\u6295\u9012',
    onlyForeign: '\u53ea\u6295\u5916\u4f01',
    blockOutsource: '\u5916\u5305\u62e6\u622a',
    onlyActiveHr: '\u8fc7\u6ee4\u4e0d\u6d3b\u8dc3HR',
    activeHrDays: 'HR\u6d3b\u8dc3\u5929\u6570',
    foreignKeywords: '\u5916\u4f01\u5173\u952e\u8bcd',
    outsourceKeywords: '\u5916\u5305\u62e6\u622a\u540d\u5355',
    resetForeign: '\u6062\u590d\u9ed8\u8ba4\u5916\u4f01\u5173\u952e\u8bcd',
    resetOutsource: '\u6062\u590d\u9ed8\u8ba4\u5916\u5305\u540d\u5355',
    start: '\u5f00\u59cb\u6295\u9012',
    stop: '\u505c\u6b62',
    scan: '\u626b\u63cf\u5f53\u524d\u9875',
    clearHistory: '\u6e05\u7a7a\u5386\u53f2',
    ready: '\u5c31\u7eea',
    running: '\u8fd0\u884c\u4e2d',
    stopped: '\u5df2\u505c\u6b62',
    success: '\u6210\u529f',
    skipped: '\u8df3\u8fc7',
    failed: '\u5931\u8d25',
    scanned: '\u626b\u63cf',
    unknownJob: '\u672a\u77e5\u5c97\u4f4d',
    unknownCompany: '\u672a\u77e5\u516c\u53f8',
    unknownSalary: '\u85aa\u8d44\u672a\u77e5',
    unknownArea: '\u5730\u70b9\u672a\u77e5',
    startRun: '\u5df2\u70b9\u51fb\u5f00\u59cb\u6295\u9012\uff0c\u6b63\u5728\u521d\u59cb\u5316...',
    stopRun: '\u6295\u9012\u6d41\u7a0b\u7ed3\u675f',
    maxReached: '\u5df2\u8fbe\u5230\u6700\u5927\u6295\u9012\u6570\uff0c\u505c\u6b62',
    noPending: '\u672a\u627e\u5230\u65b0\u7684\u5f85\u6295\u5c97\u4f4d',
    noMore: '\u8fde\u7eed\u591a\u6b21\u4e0b\u6ed1/\u7ffb\u9875\u6ca1\u6709\u65b0\u5c97\u4f4d\uff0c\u505c\u6b62',
    noNewAfterLoad: '\u672c\u6b21\u7ffb\u9875/\u52a0\u8f7d\u672a\u53d1\u73b0\u65b0\u5c97\u4f4d',
    scanFound: '\u626b\u63cf\u5b8c\u6210\uff0c\u5f53\u524d\u6355\u83b7\u5c97\u4f4d\u6570\uff1a',
    skipHistoryLog: '\u8df3\u8fc7\u672c\u5730\u5386\u53f2\uff1a',
    skipPageApplied: '\u8df3\u8fc7\u9875\u9762\u5df2\u6295\u9012/\u5df2\u6c9f\u901a\uff1a',
    skipOutsource: '\u8df3\u8fc7\u5916\u5305\u516c\u53f8/\u5916\u5305\u5c97\u4f4d',
    skipNonForeign: '\u8df3\u8fc7\u975e\u5916\u4f01/\u672a\u547d\u4e2d\u5916\u4f01\u5173\u952e\u8bcd\uff1a',
    foreignHit: '\u547d\u4e2d\u5916\u4f01\u5173\u952e\u8bcd',
    skipInactiveHr: '\u8df3\u8fc7\u4e0d\u6d3b\u8dc3HR',
    activeHr: 'HR\u8fd1\u671f\u6d3b\u8dc3',
    noActiveInfo: '\u65e0HR\u6d3b\u8dc3\u4fe1\u606f',
    noApplyButton: '\u672a\u627e\u5230\u6295\u9012/\u5f00\u804a\u6309\u94ae\uff0c\u8df3\u8fc7\uff1a',
    openDetail: '\u6574\u6761\u5217\u5361\u672a\u627e\u5230\u5f00\u804a\u6309\u94ae\uff0c\u4e0d\u8df3\u8f6c\u8be6\u60c5\u9875\uff0c\u8df3\u8fc7\uff1a',
    applySuccess: '\u6295\u9012/\u5f00\u804a\u6210\u529f\uff1a',
    applyAlready: '\u8bc6\u522b\u4e3a\u5df2\u6295\u9012/\u5df2\u6c9f\u901a\uff1a',
    clickedNoResult: '\u5df2\u70b9\u51fb\uff0c\u4f46\u672a\u76d1\u542c\u5230\u5f00\u804a/\u6295\u9012\u6210\u529f\u7ed3\u679c\uff1a',
    applyFailed: '\u6295\u9012\u5931\u8d25\uff1a',
    blockDetected: '\u53ef\u80fd\u9047\u5230\u767b\u5f55/\u9a8c\u8bc1/\u98ce\u63a7\uff0c\u5df2\u505c\u6b62\uff1a',
    historyCleared: '\u672c\u5730\u5386\u53f2\u5df2\u6e05\u7a7a',
    foreignResetDone: '\u5df2\u6062\u590d\u9ed8\u8ba4\u5916\u4f01\u5173\u952e\u8bcd',
    outsourceResetDone: '\u5df2\u6062\u590d\u9ed8\u8ba4\u5916\u5305\u62e6\u622a\u540d\u5355',
    confirmClear: '\u786e\u5b9a\u6e05\u7a7a\u730e\u8058\u81ea\u52a8\u6295\u9012\u7684\u672c\u5730\u5386\u53f2\u5417\uff1f',
    stoppedByUser: '\u5df2\u624b\u52a8\u505c\u6b62'
  };

  const state = {
    running: false,
    scrollCount: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    scanned: 0,
    processedKeys: new Set(),
    capturedJobs: new Map(),
    emptyScrollBatches: 0,
    runId: 0,
    stopReason: '',
    lastApplyNetworkEvent: null,
    networkSeq: 0,
  };

  const defaultSettings = {
    maxApply: 30,
    intervalSeconds: 4,
    autoLoadMore: true,
    skipHistory: true,
    onlyForeignCompany: false,
    foreignKeywords: '\u5916\u4f01,\u6b27\u7f8e,\u7f8e\u56fd,\u6b27\u6d32,\u5fb7\u56fd,\u6cd5\u56fd,\u82f1\u56fd,\u745e\u58eb,\u745e\u5178,\u8377\u5170,\u4e39\u9ea6,\u82ac\u5170,\u632a\u5a01,\u65e5\u672c,\u97e9\u56fd,\u65b0\u52a0\u5761,\u8de8\u56fd\u516c\u53f8,\u4e16\u754c500\u5f3a,Fortune,NASDAQ,NYSE,\u7eb3\u65af\u8fbe\u514b,\u7ebd\u4ea4\u6240,\u5916\u8d44,\u5408\u8d44,\u72ec\u8d44,\u4ee3\u8868\u5904,\u529e\u4e8b\u5904,\u4e2d\u56fd\u533a,\u4e9a\u592a,APAC,MNC,Global,International',
    blockOutsourceCompany: false,
    outsourceKeywords: [
      '\u4e2d\u8f6f\u56fd\u9645', '\u4e2d\u79d1\u521b\u8fbe', '\u535a\u5f66\u79d1\u6280', '\u8f6f\u901a\u52a8\u529b', '\u6587\u601d\u6d77\u8f89', '\u4e1c\u8f6f',
      '\u4e0a\u6d77\u601d\u82ae', '\u79d1\u745e', '\u9ad8\u4f1f\u8fbe', '\u4e2d\u667a', '\u5916\u670d', '\u4e2d\u4f01\u4eba\u529b', '\u6613\u624d', '\u8682\u8681HR',
      '\u7d2b\u5ddd\u8f6f\u4ef6', '\u6613\u601d\u535a', '\u9ea6\u4e9a\u4fe1', '\u957f\u4eae', '\u4eac\u5317\u65b9', '\u5fae\u521b', '\u9f0e\u9a70', '\u62d3\u4fdd\u8f6f\u4ef6',
      '\u6b66\u6c49\u4f70\u94a7\u6210', '\u4f70\u94a7\u6210', '\u535a\u60a6\u79d1\u521b', '\u4ebf\u79d1\u8fbe', '\u9752\u67cf\u4fe1\u606f', '\u535a\u96c5\u4e92\u52a8',
      '\u535a\u5965\u7279\u79d1\u6280', '\u91d1\u8bc1\u80a1\u4efd', '\u5370\u5b5a\u745f\u65af', 'Infosys', '\u524d\u6d77\u6cf0\u5766\u79d1\u6280', '\u798f\u745e\u5170\u65af', 'SapFreelance',
      '\u51cc\u5fd7\u8f6f\u4ef6', '\u6cd5\u672c\u4fe1\u606f', '\u67ef\u83b1\u7279', '\u4e2d\u79d1\u8f6f', '\u6d6a\u6f6e\u8f6f\u4ef6', '\u4e9a\u4fe1\u79d1\u6280', '\u65b0\u81f4\u8f6f\u4ef6',
      'IBM\u5916\u5305', '\u5317\u4eac\u5916\u4f01\u5fb7\u79d1', '\u5916\u4f01\u5fb7\u79d1', 'FESCO Adecco', '\u5fb7\u79d1\u4fe1\u606f', '\u6d77\u9686\u8f6f\u4ef6', '\u5b87\u4fe1\u79d1\u6280',
      '\u6c49\u5fb7', '\u6c49\u5f97', '\u79d1\u84dd', '\u4ebf\u8fea', '\u6d77\u535a\u62d3\u5929', '\u795e\u9a6c', '\u535a\u6717', '\u4e2d\u548c\u8f6f\u4ef6', '\u4ebf\u8fbe',
      '\u51ef\u6377', 'Capgemini', '\u57c3\u68ee\u54f2', 'Accenture', '\u666e\u534e\u6c38\u9053\u4fe1\u606f\u6280\u672f', '\u4fe1\u5fc5\u4f18', '\u6da6\u548c', '\u795e\u5dde\u6570\u7801',
      '\u4fe1\u534e\u4fe1', '\u5927\u8fde\u534e\u4fe1', '\u4e2d\u7535\u6587\u601d\u6d77\u8f89', '\u4e2d\u7535\u91d1\u4fe1', '\u9879\u76ee\u5916\u5305', '\u4eba\u529b\u5916\u5305',
      '\u8f6f\u4ef6\u5916\u5305', '\u5916\u5305', '\u5916\u6d3e', '\u9a7b\u573a', '\u9a7b\u573a\u5f00\u53d1', '\u52b3\u52a1\u6d3e\u9063', '\u6d3e\u9063', 'OD', 'ODC', 'ITO', 'BPO'
    ].join(','),
    onlyActiveBoss: false,
    activeBossDays: 3,
    panelLeft: null,
    panelTop: null,
    panelCollapsed: false
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const randomDelay = (baseMs) => baseMs + Math.floor(Math.random() * Math.min(1500, Math.max(500, baseMs * 0.4)));
  const safeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const loadSettings = () => {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch (_) {
      return { ...defaultSettings };
    }
  };

  const settings = loadSettings();
  const saveSettings = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

  const parseKeywords = (value) => String(value || '')
    .split(/[\n,，;；|、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const formatKeywords = (value) => parseKeywords(value).join(',');

  const jobSearchText = (job) => [
    job && job.company,
    job && job.title,
    job && job.salary,
    job && job.area,
    job && job.extraText,
    job && job.activeText,
    job && job.url
  ].filter(Boolean).join(' ').toLowerCase();

  const foreignCompanyHit = (job) => {
    if (!settings.onlyForeignCompany) return null;
    const keywords = parseKeywords(settings.foreignKeywords || defaultSettings.foreignKeywords);
    if (!keywords.length) return null;
    const target = jobSearchText(job);
    return keywords.find((keyword) => target.includes(keyword.toLowerCase())) || null;
  };

  const outsourceCompanyHit = (job) => {
    if (!settings.blockOutsourceCompany) return null;
    const keywords = parseKeywords(settings.outsourceKeywords || defaultSettings.outsourceKeywords);
    if (!keywords.length) return null;
    const target = jobSearchText(job);
    return keywords.find((keyword) => target.includes(keyword.toLowerCase())) || null;
  };

  const safeJsonParse = (value) => {
    if (!value || typeof value !== 'string') return null;
    try { return JSON.parse(value); } catch (_) { return null; }
  };

  const extractResponseMessage = (data) => {
    if (!data) return '';
    if (typeof data === 'string') return data.slice(0, 200);
    const candidates = [data.message, data.msg, data.errorMsg, data.errorMessage, data.toast, data.tips, data.detail, data.reason];
    for (const item of candidates) {
      const text = safeText(item);
      if (text) return text.slice(0, 200);
    }
    return '';
  };

  const isSuccessResponse = (data, status) => {
    if (status && (status < 200 || status >= 300)) return false;
    if (typeof data === 'string' && (CHAT_BLOCK_TEXT_PATTERN.test(data) || BLOCK_REASONS.test(data))) return false;
    if (!data || typeof data !== 'object') return status >= 200 && status < 300;
    if (data.serviceError === true || data.success === false || data.flag === false) return false;
    if (data.flag === true || data.flag === 1 || data.flag === '1') return true;
    const code = data.code ?? data.status ?? data.errorCode ?? data.flag;
    if (code === undefined || code === null || code === '') return true;
    const text = String(code).toLowerCase();
    return text === '0' || text === '1' || text === '200' || text === 'success' || text === 'true';
  };

  const summarizeOpenChatFailure = (data, status) => {
    const parts = [];
    if (status) parts.push('HTTP ' + status);
    if (data && typeof data === 'object') {
      const code = data.code ?? data.status ?? data.errorCode ?? data.flag;
      if (code !== undefined && code !== null && code !== '') parts.push('code=' + code);
    }
    const message = extractResponseMessage(data);
    if (message) parts.push(message);
    return parts.join(' / ') || 'open_chat_api_failed';
  };

  const rememberApplyNetworkEvent = (url, data, status, requestBody) => {
    if (!OPEN_CHAT_API_PATTERN.test(String(url || ''))) return;
    const success = isSuccessResponse(data, status);
    const message = success ? extractResponseMessage(data) : summarizeOpenChatFailure(data, status);
    state.networkSeq += 1;
    state.lastApplyNetworkEvent = {
      seq: state.networkSeq,
      time: Date.now(),
      url: String(url || ''),
      status: success ? 'success' : 'blocked',
      reason: message || (success ? 'open_chat_api_success' : 'open_chat_api_failed'),
      requestBody: requestBody || ''
    };
  };

  const patchNetwork = () => {
    if (window.__liepinAutoApplyNetworkPatched) return;
    window.__liepinAutoApplyNetworkPatched = true;
    const nativeFetch = window.fetch;
    if (typeof nativeFetch === 'function') {
      window.fetch = async function patchedFetch(input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        const requestBody = init && init.body ? String(init.body) : '';
        const response = await nativeFetch.apply(this, arguments);
        if (OPEN_CHAT_API_PATTERN.test(String(url || ''))) {
          response.clone().text().then((text) => {
            rememberApplyNetworkEvent(url, safeJsonParse(text) || text, response.status, requestBody);
          }).catch(() => {});
        }
        return response;
      };
    }
    const nativeOpen = XMLHttpRequest.prototype.open;
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
      this.__lpAaUrl = url;
      return nativeOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function patchedSend(body) {
      const xhr = this;
      const url = xhr.__lpAaUrl || '';
      if (OPEN_CHAT_API_PATTERN.test(String(url || ''))) {
        xhr.addEventListener('loadend', () => {
          let responseText = '';
          try { responseText = xhr.responseText || ''; } catch (_) {}
          rememberApplyNetworkEvent(url, safeJsonParse(responseText) || responseText, xhr.status, body ? String(body) : '');
        });
      }
      return nativeSend.apply(this, arguments);
    };
  };

  const loadHistory = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
      const now = Date.now();
      const entries = Object.entries(raw || {})
        .filter(([, record]) => record && Number.isFinite(Number(record.time)) && now - Number(record.time) <= HISTORY_TTL)
        .sort((a, b) => Number(b[1].time) - Number(a[1].time))
        .slice(0, HISTORY_MAX);
      return new Map(entries);
    } catch (_) {
      return new Map();
    }
  };

  const history = loadHistory();

  const saveHistory = () => {
    const entries = Array.from(history.entries())
      .sort((a, b) => Number(b[1].time) - Number(a[1].time))
      .slice(0, HISTORY_MAX);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(Object.fromEntries(entries)));
  };

  const historyPart = (value) => safeText(value).toLowerCase();

  const historyKeysOf = (job) => {
    if (!job) return [];
    const keys = new Set();
    if (job.key) keys.add(job.key);
    const id = extractJobId(job.url);
    if (id) keys.add('id:' + id);
    const title = historyPart(job.title);
    const company = historyPart(job.company);
    if (title || company) keys.add('text:' + title + '|' + company);
    if (company && title) keys.add('company-title:' + company + ':' + title);
    return Array.from(keys).filter(Boolean);
  };

  const findHistory = (job) => {
    for (const key of historyKeysOf(job)) {
      const record = history.get(key);
      if (record) return { key, record };
    }
    return null;
  };

  const recordHistory = (job, status, reason) => {
    const keys = historyKeysOf(job);
    if (!keys.length) return;
    const record = {
      time: Date.now(),
      status: status,
      reason: reason || '',
      title: job.title || '',
      company: job.company || '',
      salary: job.salary || '',
      area: job.area || '',
      url: job.url || ''
    };
    keys.forEach((key) => history.set(key, record));
    saveHistory();
  };

  const injectStyle = () => {
    if (document.getElementById('liepin-auto-apply-style')) return;
    const style = document.createElement('style');
    style.id = 'liepin-auto-apply-style';
    style.textContent = [
      '#liepin-auto-apply-panel{position:fixed;right:20px;top:90px;width:360px;z-index:2147483647;background:rgba(255,255,255,.98);color:#222;border:1px solid #dcdfe6;border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.16);font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif;overflow:hidden}',
      '#liepin-auto-apply-panel *{box-sizing:border-box}',
      '#liepin-auto-apply-panel.lp-aa-collapsed{width:190px}',
      '.lp-aa-header{display:flex;align-items:center;justify-content:space-between;padding:9px 10px;background:#0052d9;color:#fff;cursor:move;user-select:none}',
      '.lp-aa-header strong{font-size:14px;font-weight:700}',
      '.lp-aa-header button{width:24px;height:24px;border:0;border-radius:6px;background:rgba(255,255,255,.18);color:#fff;cursor:pointer}',
      '.lp-aa-body{padding:10px}',
      '.lp-aa-collapsed .lp-aa-body{display:none}',
      '.lp-aa-row{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.lp-aa-row label{flex:1;color:#333}',
      '.lp-aa-row input[type=number]{width:90px;border:1px solid #dcdfe6;border-radius:6px;padding:5px 6px}',
      '.lp-aa-textarea{width:100%;min-height:48px;max-height:90px;resize:vertical;border:1px solid #dcdfe6;border-radius:7px;padding:6px;margin:0 0 8px;font:12px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Arial,sans-serif}',
      '.lp-aa-inline{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0 6px;color:#606266;font-size:12px}',
      '.lp-aa-link{border:0;background:transparent;color:#0052d9;cursor:pointer;padding:0;font-size:12px}',
      '.lp-aa-disabled{opacity:.55}',
      '.lp-aa-disabled input{cursor:not-allowed;background:#f5f7fa;color:#999}',
      '.lp-aa-check{justify-content:flex-start}',
      '.lp-aa-check input{margin:0}',
      '.lp-aa-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}',
      '.lp-aa-actions button,.lp-aa-secondary button{border:0;border-radius:7px;padding:7px 8px;cursor:pointer;background:#edf3ff;color:#0052d9;font-weight:600}',
      '.lp-aa-actions button.lp-aa-primary{background:#0052d9;color:#fff}',
      '.lp-aa-actions button.lp-aa-danger{background:#fff1f0;color:#cf1322}',
      '.lp-aa-actions button:disabled,.lp-aa-secondary button:disabled{background:#e5e7eb;color:#9ca3af;box-shadow:none;cursor:not-allowed;opacity:.8}',
      '.lp-aa-secondary{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}',
      '.lp-aa-status{display:flex;justify-content:space-between;gap:8px;border-top:1px solid #ebeef5;padding-top:8px;margin-top:8px;color:#606266;font-size:12px}',
      '.lp-aa-log{height:150px;overflow:auto;border:1px solid #ebeef5;border-radius:7px;background:#fafafa;padding:6px;font-size:12px;color:#303133}',
      '.lp-aa-log div{margin-bottom:4px;word-break:break-word}',
      '.lp-aa-log .ok{color:#067d17}',
      '.lp-aa-log .warn{color:#ad6800}',
      '.lp-aa-log .error{color:#cf1322}',
      '.lp-aa-log .muted{color:#909399}'
    ].join('\n');
    document.head.appendChild(style);
  };

  const createPanel = () => {
    if (document.getElementById('liepin-auto-apply-panel')) return;
    injectStyle();
    const panel = document.createElement('div');
    panel.id = 'liepin-auto-apply-panel';
    if (settings.panelLeft !== null) panel.style.left = settings.panelLeft + 'px';
    if (settings.panelTop !== null) panel.style.top = settings.panelTop + 'px';
    if (settings.panelLeft !== null) panel.style.right = 'auto';
    if (settings.panelCollapsed) panel.classList.add('lp-aa-collapsed');
    panel.innerHTML = [
      '<div class="lp-aa-header" id="lp-aa-drag"><strong>', T.panelTitle, '</strong><button type="button" id="lp-aa-collapse" title="', T.collapse, '">', settings.panelCollapsed ? '+' : '-', '</button></div>',
      '<div class="lp-aa-body">',
      '<div class="lp-aa-row"><label for="lp-aa-max">', T.maxApply, '</label><input id="lp-aa-max" type="number" min="1" max="999" step="1"></div>',
      '<div class="lp-aa-row"><label for="lp-aa-interval">', T.interval, '</label><input id="lp-aa-interval" type="number" min="1" max="60" step="1"></div>',
      '<div class="lp-aa-row" id="lp-aa-active-row"><label for="lp-aa-active-days">', T.activeHrDays, '</label><input id="lp-aa-active-days" type="number" min="0" max="365" step="1"></div>',
      '<label class="lp-aa-row lp-aa-check"><input id="lp-aa-auto" type="checkbox"><span>', T.autoLoadMore, '</span></label>',
      '<label class="lp-aa-row lp-aa-check"><input id="lp-aa-history" type="checkbox"><span>', T.skipHistory, '</span></label>',
      '<label class="lp-aa-row lp-aa-check"><input id="lp-aa-only-foreign" type="checkbox"><span>', T.onlyForeign, '</span></label>',
      '<label class="lp-aa-row lp-aa-check"><input id="lp-aa-block-outsource" type="checkbox"><span>', T.blockOutsource, '</span></label>',
      '<label class="lp-aa-row lp-aa-check"><input id="lp-aa-only-active" type="checkbox"><span>', T.onlyActiveHr, '</span></label>',
      '<div class="lp-aa-inline"><span>', T.foreignKeywords, '</span><button type="button" class="lp-aa-link" id="lp-aa-reset-foreign">', T.resetForeign, '</button></div>',
      '<textarea class="lp-aa-textarea" id="lp-aa-foreign-keywords"></textarea>',
      '<div class="lp-aa-inline"><span>', T.outsourceKeywords, '</span><button type="button" class="lp-aa-link" id="lp-aa-reset-outsource">', T.resetOutsource, '</button></div>',
      '<textarea class="lp-aa-textarea" id="lp-aa-outsource-keywords"></textarea>',
      '<div class="lp-aa-actions"><button type="button" class="lp-aa-primary" id="lp-aa-start">', T.start, '</button><button type="button" class="lp-aa-danger" id="lp-aa-stop">', T.stop, '</button></div>',
      '<div class="lp-aa-secondary"><button type="button" id="lp-aa-scan">', T.scan, '</button><button type="button" id="lp-aa-clear">', T.clearHistory, '</button></div>',
      '<div class="lp-aa-status"><span id="lp-aa-run-state">', T.ready, '</span><span id="lp-aa-stats"></span></div>',
      '<div class="lp-aa-log" id="lp-aa-log"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(panel);
    bindPanel(panel);
    updatePanel();
    log(T.ready, 'muted');
  };

  const byId = (id) => document.getElementById(id);

  const bindPanel = (panel) => {
    const maxInput = byId('lp-aa-max');
    const intervalInput = byId('lp-aa-interval');
    const activeDaysInput = byId('lp-aa-active-days');
    const autoInput = byId('lp-aa-auto');
    const historyInput = byId('lp-aa-history');
    const onlyForeignInput = byId('lp-aa-only-foreign');
    const blockOutsourceInput = byId('lp-aa-block-outsource');
    const onlyActiveInput = byId('lp-aa-only-active');
    const foreignKeywordsInput = byId('lp-aa-foreign-keywords');
    const outsourceKeywordsInput = byId('lp-aa-outsource-keywords');
    maxInput.value = settings.maxApply;
    intervalInput.value = settings.intervalSeconds;
    activeDaysInput.value = settings.activeBossDays ?? defaultSettings.activeBossDays;
    autoInput.checked = settings.autoLoadMore;
    historyInput.checked = settings.skipHistory;
    onlyForeignInput.checked = settings.onlyForeignCompany === true;
    blockOutsourceInput.checked = settings.blockOutsourceCompany === true;
    onlyActiveInput.checked = settings.onlyActiveBoss === true;
    foreignKeywordsInput.value = formatKeywords(settings.foreignKeywords || defaultSettings.foreignKeywords);
    outsourceKeywordsInput.value = formatKeywords(settings.outsourceKeywords || defaultSettings.outsourceKeywords);

    const saveFromPanel = () => {
      settings.maxApply = Math.max(1, Math.min(999, Number(maxInput.value) || defaultSettings.maxApply));
      settings.intervalSeconds = Math.max(1, Math.min(60, Number(intervalInput.value) || defaultSettings.intervalSeconds));
      settings.activeBossDays = Math.max(0, Math.min(365, Number(activeDaysInput.value) || defaultSettings.activeBossDays));
      settings.autoLoadMore = Boolean(autoInput.checked);
      settings.skipHistory = Boolean(historyInput.checked);
      settings.onlyForeignCompany = Boolean(onlyForeignInput.checked);
      settings.blockOutsourceCompany = Boolean(blockOutsourceInput.checked);
      settings.onlyActiveBoss = Boolean(onlyActiveInput.checked);
      settings.foreignKeywords = formatKeywords(foreignKeywordsInput.value || defaultSettings.foreignKeywords);
      settings.outsourceKeywords = formatKeywords(outsourceKeywordsInput.value || defaultSettings.outsourceKeywords);
      updateActiveDaysInputState();
      saveSettings();
    };

    [maxInput, intervalInput, activeDaysInput, autoInput, historyInput, onlyForeignInput, blockOutsourceInput, onlyActiveInput, foreignKeywordsInput, outsourceKeywordsInput].forEach((input) => {
      input.addEventListener('change', saveFromPanel);
      input.addEventListener('input', saveFromPanel);
    });

    onlyActiveInput.addEventListener('change', updateActiveDaysInputState);
    byId('lp-aa-reset-foreign').addEventListener('click', () => {
      foreignKeywordsInput.value = formatKeywords(defaultSettings.foreignKeywords);
      settings.foreignKeywords = formatKeywords(defaultSettings.foreignKeywords);
      saveSettings();
      log(T.foreignResetDone, 'ok');
    });
    byId('lp-aa-reset-outsource').addEventListener('click', () => {
      outsourceKeywordsInput.value = formatKeywords(defaultSettings.outsourceKeywords);
      settings.outsourceKeywords = formatKeywords(defaultSettings.outsourceKeywords);
      saveSettings();
      log(T.outsourceResetDone, 'ok');
    });
    updateActiveDaysInputState();

    byId('lp-aa-start').addEventListener('click', () => {
      const startButton = byId('lp-aa-start');
      if (state.running || startButton?.disabled) return;
      if (startButton) {
        startButton.disabled = true;
        startButton.textContent = '\u6295\u9012\u4e2d...';
      }
      saveFromPanel();
      startAutoApply();
    });
    byId('lp-aa-stop').addEventListener('click', () => stopAutoApply(T.stoppedByUser));
    byId('lp-aa-scan').addEventListener('click', () => {
      captureJobsFromDom();
      log(T.scanFound + state.capturedJobs.size, 'muted');
      updatePanel();
    });
    byId('lp-aa-clear').addEventListener('click', () => {
      if (!window.confirm(T.confirmClear)) return;
      history.clear();
      saveHistory();
      log(T.historyCleared, 'warn');
    });
    byId('lp-aa-collapse').addEventListener('click', (event) => {
      event.stopPropagation();
      settings.panelCollapsed = !settings.panelCollapsed;
      panel.classList.toggle('lp-aa-collapsed', settings.panelCollapsed);
      event.currentTarget.textContent = settings.panelCollapsed ? '+' : '-';
      saveSettings();
    });

    bindDrag(panel, byId('lp-aa-drag'));
  };

  const updateActiveDaysInputState = () => {
    const input = byId('lp-aa-active-days');
    const row = byId('lp-aa-active-row');
    const onlyActive = byId('lp-aa-only-active');
    if (!input || !row || !onlyActive) return;
    const disabled = !onlyActive.checked;
    input.disabled = disabled;
    row.classList.toggle('lp-aa-disabled', disabled);
  };

  const bindDrag = (panel, handle) => {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    handle.addEventListener('mousedown', (event) => {
      if (event.target && event.target.tagName === 'BUTTON') return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      event.preventDefault();
    });
    document.addEventListener('mousemove', (event) => {
      if (!dragging) return;
      const nextLeft = Math.max(0, Math.min(window.innerWidth - 80, startLeft + event.clientX - startX));
      const nextTop = Math.max(0, Math.min(window.innerHeight - 40, startTop + event.clientY - startY));
      panel.style.left = nextLeft + 'px';
      panel.style.top = nextTop + 'px';
      panel.style.right = 'auto';
      settings.panelLeft = Math.round(nextLeft);
      settings.panelTop = Math.round(nextTop);
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      saveSettings();
    });
  };

  const updatePanel = () => {
    const runState = byId('lp-aa-run-state');
    const stats = byId('lp-aa-stats');
    const start = byId('lp-aa-start');
    const stop = byId('lp-aa-stop');
    if (runState) runState.textContent = state.running ? T.running : T.stopped;
    if (stats) {
      stats.textContent = T.success + ' ' + state.success + ' / ' + T.skipped + ' ' + state.skipped + ' / ' + T.failed + ' ' + state.failed + ' / ' + T.scanned + ' ' + state.scanned;
    }
    if (start) {
      start.disabled = state.running;
      start.textContent = state.running ? '\u6295\u9012\u4e2d...' : T.start;
    }
    if (stop) stop.disabled = !state.running;
  };

  const log = (message, type) => {
    const box = byId('lp-aa-log');
    if (!box) return;
    const line = document.createElement('div');
    if (type) line.className = type;
    line.textContent = '[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '] ' + message;
    box.appendChild(line);
    while (box.children.length > 240) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  };

  const isVisible = (element) => {
    if (!element || !(element instanceof Element)) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const getLines = (element) => String((element && (element.innerText || element.textContent)) || '')
    .split(/\n+/)
    .map(safeText)
    .filter(Boolean);

  const trimField = (value, maxLen) => {
    const text = safeText(value);
    if (!text) return '';
    return text.length > maxLen ? text.slice(0, maxLen - 3) + '...' : text;
  };

  const pickTextBySelectors = (root, selectors, maxLen) => {
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = Array.from(root.querySelectorAll(selector));
      } catch (_) {
        nodes = [];
      }
      for (const node of nodes) {
        const lines = getLines(node);
        for (const line of lines) {
          if (line.length >= 2 && line.length <= maxLen) return trimField(line, maxLen);
        }
      }
    }
    return '';
  };

  const extractByPattern = (text, pattern) => {
    const match = safeText(text).match(pattern);
    return match ? match[0] : '';
  };

  const extractActiveTextFromCard = (card) => {
    if (!card) return '';
    const candidates = [
      ...Array.from(card.querySelectorAll('[class*=active], [class*=online], [class*=time], [class*=hr], [class*=recruiter], [class*=boss], [class*=tag]')),
      card
    ];
    for (const element of candidates) {
      const text = safeText(element.innerText || element.textContent || '');
      if (!text) continue;
      const match = text.match(ACTIVE_TEXT_PATTERN);
      if (match) return safeText(match[0]);
    }
    return '';
  };

  const chineseNumberValue = (value) => {
    const text = safeText(value);
    if (!text) return null;
    if (text === '\u534a') return 0.5;
    const digits = { '\u4e00': 1, '\u4e8c': 2, '\u4e24': 2, '\u4e09': 3, '\u56db': 4, '\u4e94': 5, '\u516d': 6, '\u4e03': 7, '\u516b': 8, '\u4e5d': 9 };
    if (digits[text] != null) return digits[text];
    if (text === '\u5341') return 10;
    const match = text.match(/^([\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d])?\u5341([\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d])?$/);
    if (match) return (digits[match[1]] || 1) * 10 + (digits[match[2]] || 0);
    return null;
  };

  const activeThresholdDays = () => {
    const value = Number(settings.activeBossDays);
    const fallback = Number(defaultSettings.activeBossDays) || 3;
    return Math.max(0, Math.min(365, Number.isFinite(value) ? value : fallback));
  };

  const durationToDays = (amount, unit) => {
    const value = Number(amount);
    if (!Number.isFinite(value)) return null;
    if (/\u79d2|\u5206\u949f|\u5c0f\u65f6/.test(unit)) return 0;
    if (/\u5929|\u65e5/.test(unit)) return value;
    if (/\u5468/.test(unit)) return value * 7;
    if (/\u6708/.test(unit)) return value * 30;
    if (/\u5e74/.test(unit)) return value * 365;
    return null;
  };

  const extractActiveDays = (text) => {
    const normalized = safeText(text);
    if (!normalized) return null;
    if (/\u521a\u521a|\u5728\u7ebf|\u5f53\u524d|\u4eca\u65e5|\u4eca\u5929|\u79d2\u524d|\u5206\u949f\u524d|\u5c0f\u65f6\u524d/.test(normalized)) return 0;
    if (/\u6628\u65e5|\u6628\u5929/.test(normalized)) return 1;
    if (/\u524d\u5929/.test(normalized)) return 2;
    if (/\u672c\u5468/.test(normalized)) return 7;
    if (/\u672c\u6708/.test(normalized)) return 30;

    const numberMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(\u79d2|\u5206\u949f|\u5c0f\u65f6|\u5929|\u65e5|\u5468|\u6708|\u5e74)(?:\u524d|\u5185)?/);
    if (numberMatch) return durationToDays(numberMatch[1], numberMatch[2]);

    const chineseMatch = normalized.match(/([\u4e00\u4e8c\u4e24\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u534a]+)\s*(\u79d2|\u5206\u949f|\u5c0f\u65f6|\u5929|\u65e5|\u5468|\u6708|\u5e74)(?:\u524d|\u5185)?/);
    if (chineseMatch) return durationToDays(chineseNumberValue(chineseMatch[1]), chineseMatch[2]);

    return null;
  };

  const isActiveText = (text) => {
    const normalized = safeText(text);
    if (!normalized) return null;
    if (/\u4e0d\u6d3b\u8dc3|\u4e0d\u5728\u7ebf|\u79bb\u7ebf|\u5f88\u4e45/.test(normalized)) return false;
    if (/\u8fd1\u671f\u6d3b\u8dc3|\u6700\u8fd1\u6d3b\u8dc3/.test(normalized)) return true;
    const days = extractActiveDays(normalized);
    if (days !== null) return days <= activeThresholdDays();
    if (/\u6d3b\u8dc3/.test(normalized) && !/\u5468|\u6708|\u5e74|\u524d/.test(normalized)) return true;
    return null;
  };

  const isActiveHr = async (job) => {
    const activeText = job.activeText || extractActiveTextFromCard(job.card) || extractActiveTextFromCard(document.body);
    const active = isActiveText(activeText);
    if (active !== null) return { active, text: activeText || T.activeHr };
    return { active: false, text: activeText || T.noActiveInfo };
  };

  const normalizeJobUrl = (href) => {
    if (!href) return '';
    try {
      const url = new URL(href, location.href);
      const jobId = url.searchParams.get('jobId') || url.searchParams.get('positionId') || url.searchParams.get('job_id') || url.searchParams.get('position_id');
      if (jobId) return url.origin + url.pathname + '?jobId=' + jobId;
      return url.origin + url.pathname;
    } catch (_) {
      return href;
    }
  };

  const extractJobId = (href) => {
    const url = normalizeJobUrl(href || '');
    const patterns = [/jobId=([^&]+)/i, /positionId=([^&]+)/i, /job_id=([^&]+)/i, /position_id=([^&]+)/i, /\/job[-_]?detail\/([^/?#]+)/i, /\/job\/([^/?#]+)/i, /\/a\/([^/?#]+)/i];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match && match[1]) return match[1];
    }
    return '';
  };

  const buildJobKey = (job) => {
    const id = extractJobId(job.url);
    if (id) return 'id:' + id;
    const title = safeText(job.title).toLowerCase();
    const company = safeText(job.company).toLowerCase();
    const salary = safeText(job.salary).toLowerCase();
    const area = safeText(job.area).toLowerCase();
    if (title || company) return 'text:' + title + '|' + company + '|' + salary + '|' + area;
    return 'url:' + normalizeJobUrl(job.url);
  };

  const scoreJobCardCandidate = (element, anchor) => {
    if (!element || element === document.body || !isVisible(element)) return -1;
    const text = safeText(element.innerText || element.textContent || '');
    const textLength = text.length;
    if (textLength < 8 || textLength > 3500) return -1;
    const rect = element.getBoundingClientRect();
    if (rect.width < 180 || rect.height < 40) return -1;
    const hasJobLink = Array.from(element.querySelectorAll('a[href]')).some((item) => JOB_LINK_PATTERN.test(item.href || '')) || Boolean(anchor && element.contains(anchor));
    const hasSalary = looksLikeSalary(text);
    const hasCompany = Array.from(element.querySelectorAll('a[href*=\"company\"], [class*=\"company\"], [class*=\"Company\"], [class*=\"comp\"], [class*=\"Comp\"]')).some((item) => safeText(item.innerText || item.textContent || item.title).length >= 2);
    const hasActive = ACTIVE_TEXT_PATTERN.test(text);
    const className = String(element.className || '');
    let score = 0;
    if (hasJobLink) score += 30;
    if (hasSalary) score += 25;
    if (hasCompany) score += 20;
    if (hasActive) score += 12;
    if (/job-list|job-card|jobCard|job-item|jobItem|position-card|card|item/i.test(className)) score += 10;
    if (textLength >= 80 && textLength <= 1200) score += 8;
    if (textLength > 1800) score -= 20;
    if (rect.width >= 500) score += 8;
    return score;
  };

  const inferJobCard = (anchor) => {
    if (!anchor) return null;
    let best = null;
    let bestScore = -1;
    let node = anchor;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth += 1) {
      const score = scoreJobCardCandidate(node, anchor);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
      node = node.parentElement;
    }
    return best || anchor;
  };

  const firstAnchorLine = (anchor) => {
    const lines = getLines(anchor);
    return trimField(lines[0] || '', 80);
  };

  const isJobLikeCard = (element) => {
    if (!element || element === document.body || !isVisible(element)) return false;
    const text = safeText(element.innerText || element.textContent || '');
    if (text.length < 8 || text.length > 3500) return false;
    const hasJobLink = Array.from(element.querySelectorAll('a[href]')).some((anchor) => JOB_LINK_PATTERN.test(anchor.href || ''));
    const hasSalary = /(?:\d+(?:\.\d+)?-\d+(?:\.\d+)?[kK]|\d+(?:\.\d+)?-\d+(?:\.\d+)?\u4e07|\u9762\u8bae)/.test(text);
    const hasCompany = /\u516c\u53f8|\u79d1\u6280|\u4fe1\u606f|\u8f6f\u4ef6|\u7f51\u7edc|\u6709\u9650|\u80a1\u4efd|company/i.test(text);
    const hasJobWord = /C\+\+|Java|Python|Go|\u5f00\u53d1|\u5de5\u7a0b\u5e08|\u67b6\u6784|\u5ba2\u6237\u7aef|\u540e\u7aef|\u524d\u7aef|\u6d4b\u8bd5|\u8fd0\u7ef4|\u5c97\u4f4d|\u804c\u4f4d/i.test(text);
    return hasJobLink || (hasSalary && (hasCompany || hasJobWord));
  };

  const findJobAnchorInCard = (card) => {
    if (!card) return null;
    const anchors = Array.from(card.querySelectorAll('a[href]')).filter((anchor) => isVisible(anchor));
    return anchors.find((anchor) => JOB_LINK_PATTERN.test(anchor.href || '')) || anchors.find((anchor) => safeText(anchor.innerText || anchor.textContent).length >= 2) || null;
  };

  const extractFieldByLines = (card, maxLen, rejectPattern) => {
    const lines = getLines(card);
    return trimField(lines.find((line) => line.length >= 2 && line.length <= maxLen && (!rejectPattern || !rejectPattern.test(line))) || '', maxLen);
  };

  const extractAreaFromText = (text) => extractByPattern(text, /(?:\u5317\u4eac|\u4e0a\u6d77|\u5e7f\u5dde|\u6df1\u5733|\u676d\u5dde|\u6210\u90fd|\u6b66\u6c49|\u5357\u4eac|\u82cf\u5dde|\u897f\u5b89|\u5929\u6d25|\u91cd\u5e86|\u957f\u6c99|\u90d1\u5dde|\u5408\u80a5|\u53a6\u95e8|\u9752\u5c9b|\u6d4e\u5357|\u798f\u5dde|\u5b81\u6ce2|\u4e1c\u839e|\u4f5b\u5c71|\u65e0\u9521|\u5e38\u5dde)(?:[-\u00b7\s][\u4e00-\u9fa5A-Za-z0-9]+)?/);

  const looksLikeArea = (text) => Boolean(extractAreaFromText(text)) || /[-\u00b7](?:\u533a|\u53bf|\u5e02)|\u5730\u70b9|\u5730\u5740/.test(safeText(text));
  const looksLikeSalary = (text) => /(?:\d+(?:\.\d+)?-\d+(?:\.\d+)?[kK]|\d+(?:\.\d+)?-\d+(?:\.\d+)?\u4e07|\u9762\u8bae)/.test(safeText(text));
  const looksLikeCompany = (text) => /\u516c\u53f8|\u79d1\u6280|\u4fe1\u606f|\u8f6f\u4ef6|\u7f51\u7edc|\u6709\u9650|\u80a1\u4efd|\u96c6\u56e2|company/i.test(safeText(text));

  const extractJobFromCard = (card, anchor) => {
    const text = safeText(card.innerText || card.textContent || '');
    const title = pickTextBySelectors(card, [
      '[class*=job-title]', '[class*=jobTitle]', '[class*=job-name]', '[class*=jobName]',
      '[class*=position-title]', '[class*=positionName]', '[class*=position-name]', '[class*=positionName]',
      '[class*=job-name-box]', '[class*=jobNameBox]', '[class*=title]', 'h1', 'h2', 'h3'
    ], 80) || firstAnchorLine(anchor) || extractFieldByLines(card, 80, /\u516c\u53f8|\u6709\u9650|\d+-\d+|\u9762\u8bae/) || T.unknownJob;
    const company = pickTextBySelectors(card, [
      '[class*=company-name]', '[class*=companyName]', '[class*=comp-name]', '[class*=compName]',
      '[class*=company-title]', '[class*=companyTitle]', '[class*=company] a', 'a[class*=company]', '[class*=recruiter-company]'
    ], 80) || getLines(card).find((line) => line.length <= 80 && looksLikeCompany(line) && !looksLikeSalary(line) && !looksLikeArea(line)) || T.unknownCompany;
    const salary = pickTextBySelectors(card, [
      '[class*=salary]', '[class*=money]', '[class*=job-salary]', '[class*=jobSalary]'
    ], 50) || extractByPattern(text, /(?:\d+(?:\.\d+)?-\d+(?:\.\d+)?[kK](?:\u00b7\d+\u85aa)?|\d+(?:\.\d+)?-\d+(?:\.\d+)?\u4e07(?:\u00b7\d+\u85aa)?|\d+(?:\.\d+)?-\d+(?:\.\d+)?\u5143\/\u5929|\u9762\u8bae)/) || T.unknownSalary;
    const area = pickTextBySelectors(card, [
      '[class*=area]', '[class*=city]', '[class*=address]', '[class*=district]', '[class*=job-dq]', '[class*=work-place]', '[class*=job-area]', '[class*=jobArea]'
    ], 50) || extractAreaFromText(text) || T.unknownArea;
    const job = {
      title: trimField(title, 80),
      company: trimField(company, 80),
      salary: trimField(salary, 50),
      area: trimField(area, 50),
      activeText: extractActiveTextFromCard(card),
      extraText: trimField(text, 1200),
      url: normalizeJobUrl(anchor && anchor.href ? anchor.href : ''),
      card: card
    };
    job.key = buildJobKey(job);
    return job;
  };

  const jobCompletenessScore = (job) => {
    if (!job) return 0;
    let score = 0;
    if (job.title && job.title !== T.unknownJob) score += 2;
    if (job.company && job.company !== T.unknownCompany) score += 3;
    if (job.salary && job.salary !== T.unknownSalary) score += 2;
    if (job.area && job.area !== T.unknownArea) score += 1;
    score += Math.min(2, Math.floor(safeText(job.extraText || '').length / 300));
    return score;
  };

  const rememberCapturedJob = (job) => {
    if (!job || !job.key) return;
    const existing = state.capturedJobs.get(job.key);
    if (!existing || jobCompletenessScore(job) > jobCompletenessScore(existing)) {
      state.capturedJobs.set(job.key, job);
    }
  };

  const captureJobsFromDom = () => {
    const before = state.capturedJobs.size;
    const jobCards = Array.from(document.querySelectorAll(JOB_CARD_SELECTOR))
      .filter((card) => isJobLikeCard(card));
    jobCards.forEach((rawCard) => {
      const anchor = findJobAnchorInCard(rawCard) || rawCard;
      const card = inferJobCard(anchor) || rawCard;
      const job = extractJobFromCard(card, anchor);
      rememberCapturedJob(job);
    });

    const anchors = Array.from(document.querySelectorAll('a[href]'))
      .filter((anchor) => JOB_LINK_PATTERN.test(anchor.href || '') && isVisible(anchor));
    anchors.forEach((anchor) => {
      const card = inferJobCard(anchor);
      const job = extractJobFromCard(card, anchor);
      rememberCapturedJob(job);
    });

    if (SEARCH_PAGE_PATTERN.test(location.pathname) && state.capturedJobs.size === before) {
      const listChildren = Array.from(document.querySelectorAll('.job-list-box > *, .job-list-box > * > *'));
      listChildren.forEach((rawCard) => {
        if (!isJobLikeCard(rawCard)) return;
        const anchor = findJobAnchorInCard(rawCard) || rawCard;
        const card = inferJobCard(anchor) || rawCard;
        const job = extractJobFromCard(card, anchor);
        rememberCapturedJob(job);
      });
    }

    if (JOB_LINK_PATTERN.test(location.href)) {
      const fakeAnchor = document.createElement('a');
      fakeAnchor.href = location.href;
      fakeAnchor.textContent = document.title || '';
      const titleNode = document.querySelector('h1,h2,[class*=job-title],[class*=jobTitle],[class*=position-title],[class*=positionName]');
      const detailRoot = titleNode ? inferJobCard(titleNode.closest('a') || titleNode) : document.body;
      const job = extractJobFromCard(detailRoot || document.body, fakeAnchor);
      if (job.key && !state.capturedJobs.has(job.key)) state.capturedJobs.set(job.key, job);
    }
    return state.capturedJobs.size - before;
  };

  const jobLabel = (job) => [job.title, job.company, job.salary, job.area].filter(Boolean).join(' / ');

  const getClickableText = (element) => safeText(
    (element && (element.innerText || element.textContent || element.getAttribute('aria-label') || element.title || element.value)) || ''
  );

  const isDisabledElement = (element) => {
    if (!element) return true;
    const text = getClickableText(element);
    const className = String(element.className || '');
    return Boolean(element.disabled) || element.getAttribute('aria-disabled') === 'true' || /disabled|disable|forbid|unavailable/i.test(className) || DISABLED_TEXT_PATTERN.test(text);
  };

  const uniqueElements = (elements) => Array.from(new Set(elements.filter(Boolean)));

  const preferInnerClickable = (element) => {
    if (!element) return null;
    if (/^(button|a)$/i.test(element.tagName || '') || element.getAttribute('role') === 'button' || element.type === 'button' || element.type === 'submit') return element;
    const inner = Array.from(element.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]'))
      .find((item) => isVisible(item) && !isDisabledElement(item));
    return inner || element;
  };

  const isJobDetailLink = (element) => {
    const anchor = element && (element.matches?.('a[href]') ? element : element.closest?.('a[href]'));
    return Boolean(anchor && JOB_LINK_PATTERN.test(anchor.href || ''));
  };

  const scoreApplyCandidate = (element) => {
    const text = getClickableText(element).replace(/\s+/g, '');
    const className = String(element.className || '');
    const dataNick = String(element.getAttribute('data-nick') || '');
    if (!text || APPLIED_TEXT_PATTERN.test(text)) return 0;
    if (/\u7ee7\u7eed\u804a|\u804a\u4e00\u804a/.test(text)) return 120;
    if (APPLY_TEXT_PATTERN.test(text)) return 110;
    if (/chat-btn-box|recruiter-info-box-chat-btn|im-btn|imBtn/i.test(className + ' ' + dataNick)) return 100;
    if (/apply|deliver|chat|contact|im/i.test(className + ' ' + dataNick) && !DISABLED_TEXT_PATTERN.test(text)) return 80;
    return 0;
  };

  const revealCardActions = async (job) => {
    const card = job && job.card;
    if (!card) return;
    card.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = card.getBoundingClientRect();
    const points = [
      [rect.left + rect.width * 0.82, rect.top + rect.height * 0.5],
      [rect.left + rect.width * 0.94, rect.top + rect.height * 0.5],
      [rect.left + rect.width * 0.82, rect.top + rect.height * 0.78],
    ];
    for (const [clientX, clientY] of points) {
      const target = document.elementFromPoint(clientX, clientY) || card;
      [card, target].forEach((element) => {
        ['pointerover', 'mouseover', 'mouseenter', 'mousemove'].forEach((type) => {
          const EventCtor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
          element.dispatchEvent(new EventCtor(type, { bubbles: true, cancelable: true, view: window, clientX, clientY }));
        });
      });
      await sleep(180);
    }
  };

  const findApplyButton = (root, includeHidden = false) => {
    if (!root) return null;
    const selectors = 'button,a,[role=button],input[type=button],input[type=submit],[class*=apply],[class*=deliver],[class*=chat],[class*=contact],[class*=Chat],[class*=btn],[class*=Btn],[class*=button],[class*=Button],[class*=im],[class*=Im],[data-nick*=chat],[data-nick*=apply],[data-nick*=im],[data-selector*=chat],[data-selector*=apply]';
    let candidates = [];
    if (root.matches && root.matches(selectors)) candidates.push(root);
    candidates = candidates.concat(Array.from(root.querySelectorAll(selectors)));
    let best = null;
    let bestScore = 0;
    for (const rawElement of uniqueElements(candidates)) {
      const element = preferInnerClickable(rawElement);
      if (isDisabledElement(element)) continue;
      if (!includeHidden && !isVisible(element)) continue;
      if (isJobDetailLink(element)) continue;
      const score = scoreApplyCandidate(element);
      if (includeHidden && score < 100 && !isVisible(element)) continue;
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    return best;
  };


  const findNearbyApplyButton = (job) => {
    const card = job && job.card;
    if (!card) return null;
    const roots = [];
    let node = card;
    for (let depth = 0; depth < 4 && node && node !== document.body; depth += 1) {
      roots.push(node);
      if (node.parentElement) roots.push(node.parentElement);
      if (node.previousElementSibling) roots.push(node.previousElementSibling);
      if (node.nextElementSibling) roots.push(node.nextElementSibling);
      node = node.parentElement;
    }
    for (const root of uniqueElements(roots)) {
      const textLength = safeText(root.innerText || root.textContent || '').length;
      if (textLength < 8 || textLength > 2200) continue;
      const button = findApplyButton(root) || findApplyButton(root, true);
      if (button) return button;
    }
    return null;
  };

  const hasAppliedText = (root) => {
    if (!root) return false;
    const text = safeText(root.innerText || root.textContent || '');
    if (APPLIED_TEXT_PATTERN.test(text)) return true;
    const button = findApplyButton(root);
    return button ? APPLIED_TEXT_PATTERN.test(getClickableText(button)) : false;
  };

  const getVisibleOverlayRoots = () => {
    const selector = [
      '[role=dialog]', '.ant-modal', '.ant-modal-wrap', '.ant-modal-root', '.el-dialog', '.el-message-box',
      '.modal', '.dialog', '[class*=modal]', '[class*=dialog]', '[class*=popover]', '[class*=popup]',
      '[class*=toast]', '[class*=message]'
    ].join(',');
    return uniqueElements(Array.from(document.querySelectorAll(selector)).filter((root) => {
      if (!isVisible(root)) return false;
      const textLength = safeText(root.innerText || root.textContent).length;
      return textLength > 0 && textLength < 5000;
    }));
  };

  const findConfirmButton = () => {
    const roots = getVisibleOverlayRoots();
    const searchRoots = roots.length ? roots : [document.body];
    for (const root of searchRoots) {
      const rootText = safeText(root.innerText || root.textContent || '');
      const candidates = Array.from(root.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]'));
      for (const element of candidates) {
        if (!isVisible(element) || isDisabledElement(element)) continue;
        const text = getClickableText(element).replace(/\s+/g, '');
        if (CONFIRM_TEXT_PATTERN.test(text)) return element;
        if (SAFETY_TIP_PATTERN.test(rootText) && /^(?:\u4e86\u89e3|\u6211\u77e5\u9053\u4e86|\u77e5\u9053\u4e86)$/.test(text)) return element;
      }
    }
    return null;
  };

  const recentApplyNetworkOutcome = (sinceSeq, sinceTime) => {
    const event = state.lastApplyNetworkEvent;
    if (!event) return { status: '', reason: '' };
    if (event.seq <= sinceSeq || event.time < sinceTime) return { status: '', reason: '' };
    return { status: event.status, reason: event.reason || 'open_chat_api' };
  };

  const hasOpenChatUi = () => {
    const roots = getVisibleOverlayRoots().concat(Array.from(document.querySelectorAll('[class*=im], [class*=chat], [class*=Chat], [class*=message], iframe[src*=im], iframe[src*=chat]')));
    return uniqueElements(roots).some((root) => {
      if (!isVisible(root)) return false;
      const text = safeText(root.innerText || root.textContent || root.getAttribute('title') || root.getAttribute('aria-label') || '');
      const marker = String(root.className || '') + ' ' + String(root.src || '');
      if (root.tagName === 'IFRAME' && /im|chat/i.test(marker)) return true;
      if (CHAT_OPEN_TEXT_PATTERN.test(text)) return true;
      return /im|chat/i.test(marker) && Boolean(root.querySelector?.('textarea,input,[contenteditable=true]'));
    });
  };

  const detectOutcome = (job, sinceSeq = state.networkSeq, sinceTime = Date.now()) => {
    const networkOutcome = recentApplyNetworkOutcome(sinceSeq, sinceTime);
    if (networkOutcome.status) return networkOutcome;
    const areas = uniqueElements([job && job.card].concat(getVisibleOverlayRoots()));
    for (const area of areas) {
      const text = safeText(area.innerText || area.textContent || '');
      if (SAFETY_TIP_PATTERN.test(text)) continue;
      if (APPLIED_TEXT_PATTERN.test(text)) return { status: 'success', reason: 'applied_text' };
      if (CHAT_BLOCK_TEXT_PATTERN.test(text) || BLOCK_REASONS.test(text)) return { status: 'blocked', reason: text.slice(0, 120) };
    }
    if (hasOpenChatUi()) return { status: 'success', reason: 'chat_window_opened' };
    return { status: '', reason: '' };
  };

  const clickElement = (element) => {
    element.scrollIntoView({ block: 'center', inline: 'center' });
    element.focus?.();
    const PointerEventCtor = window.PointerEvent || MouseEvent;
    element.dispatchEvent(new PointerEventCtor('pointerdown', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    element.dispatchEvent(new PointerEventCtor('pointerup', { bubbles: true, cancelable: true, view: window }));
    element.click();
  };

  const confirmAndDetect = async (job, sinceSeq = state.networkSeq, sinceTime = Date.now()) => {
    for (let index = 0; index < 12; index += 1) {
      await sleep(500);
      const outcome = detectOutcome(job, sinceSeq, sinceTime);
      if (outcome.status) return outcome;
      const button = findConfirmButton();
      if (button) {
        clickElement(button);
        continue;
      }
    }
    await sleep(1000);
    return detectOutcome(job, sinceSeq, sinceTime);
  };

  const getNextJob = () => {
    captureJobsFromDom();
    for (const job of state.capturedJobs.values()) {
      if (!state.processedKeys.has(job.key)) return job;
    }
    return null;
  };

  const processJob = async (job) => {
    if (!job || state.processedKeys.has(job.key)) return;
    state.processedKeys.add(job.key);
    state.scanned += 1;

    const previousHistory = settings.skipHistory ? findHistory(job) : null;
    if (previousHistory) {
      state.skipped += 1;
      log(T.skipHistoryLog + jobLabel(job), 'muted');
      updatePanel();
      return;
    }

    if (hasAppliedText(job.card)) {
      state.skipped += 1;
      recordHistory(job, 'already', 'page_applied_text');
      log(T.skipPageApplied + jobLabel(job), 'muted');
      updatePanel();
      return;
    }

    const outsourceKeyword = outsourceCompanyHit(job);
    if (outsourceKeyword) {
      state.skipped += 1;
      log(T.skipOutsource + '\u3010' + outsourceKeyword + '\u3011\uff1a' + jobLabel(job), 'warn');
      updatePanel();
      return;
    }

    const foreignKeyword = foreignCompanyHit(job);
    if (settings.onlyForeignCompany && !foreignKeyword) {
      state.skipped += 1;
      log(T.skipNonForeign + jobLabel(job), 'warn');
      updatePanel();
      return;
    }
    if (foreignKeyword) log(T.foreignHit + '\u3010' + foreignKeyword + '\u3011\uff1a' + jobLabel(job), 'ok');

    if (settings.onlyActiveBoss) {
      const activeResult = await isActiveHr(job);
      if (!activeResult.active) {
        state.skipped += 1;
        log(T.skipInactiveHr + '\u3010' + activeResult.text + '\u3011\uff1a' + jobLabel(job), 'warn');
        updatePanel();
        return;
      }
      log(T.activeHr + '\u3010' + activeResult.text + '\u3011\uff1a' + jobLabel(job), 'ok');
    }

    const detailMode = job.card === document.body || JOB_LINK_PATTERN.test(location.href);
    await revealCardActions(job);
    let button = findApplyButton(job.card) || findApplyButton(job.card, true) || findNearbyApplyButton(job) || (detailMode ? findApplyButton(document.body) : null);
    if (!button) {
      state.skipped += 1;
      log((detailMode ? T.noApplyButton : T.openDetail) + jobLabel(job), 'warn');
      updatePanel();
      return;
    }

    try {
      const sinceSeq = state.networkSeq;
      const sinceTime = Date.now();
      clickElement(button);
      const outcome = await confirmAndDetect(job, sinceSeq, sinceTime);
      if (outcome.status === 'success') {
        state.success += 1;
        recordHistory(job, 'applied', outcome.reason);
        log(T.applySuccess + jobLabel(job), 'ok');
      } else if (outcome.status === 'blocked') {
        state.failed += 1;
        log(T.applyFailed + jobLabel(job) + ' - ' + outcome.reason, 'warn');
      } else if (hasAppliedText(job.card)) {
        state.skipped += 1;
        recordHistory(job, 'already', 'applied_after_click');
        log(T.applyAlready + jobLabel(job), 'muted');
      } else {
        state.failed += 1;
        log(T.clickedNoResult + jobLabel(job), 'warn');
      }
    } catch (error) {
      state.failed += 1;
      log(T.applyFailed + jobLabel(job) + ' - ' + (error && error.message ? error.message : String(error)), 'error');
    }
    updatePanel();
  };

  const isPaginationDisabled = (element) => {
    if (!element) return true;
    const className = String(element.className || '');
    return isDisabledElement(element) || /disabled|ant-pagination-disabled/i.test(className) || element.getAttribute('aria-disabled') === 'true';
  };

  const findNextPageButton = () => {
    const preferred = [
      '.ant-pagination-next',
      'li[title="\u4e0b\u4e00\u9875"]',
      'li[aria-label="\u4e0b\u4e00\u9875"]',
      '[class*=pagination-next]',
      '[class*=PaginationNext]'
    ];
    for (const selector of preferred) {
      const element = document.querySelector(selector);
      if (element && isVisible(element) && !isPaginationDisabled(element)) return element;
    }
    const candidates = Array.from(document.querySelectorAll('button,a,li,[role=button]'));
    for (const element of candidates) {
      if (!isVisible(element) || isPaginationDisabled(element)) continue;
      const text = getClickableText(element).replace(/\s+/g, '');
      const title = safeText(element.getAttribute('title') || element.getAttribute('aria-label') || '').replace(/\s+/g, '');
      const className = String(element.className || '');
      if (NEXT_PAGE_PATTERN.test(text) || NEXT_PAGE_PATTERN.test(title) || /pagination-next/i.test(className)) return element;
    }
    return null;
  };

  const goNextPageByUrl = () => {
    if (!SEARCH_PAGE_PATTERN.test(location.pathname)) return false;
    try {
      const url = new URL(location.href);
      const currentPage = Math.max(0, Number(url.searchParams.get('currentPage')) || 0);
      url.searchParams.set('currentPage', String(currentPage + 1));
      location.href = url.toString();
      return true;
    } catch (_) {
      return false;
    }
  };

  const loadMoreOrScroll = async () => {
    const before = state.capturedJobs.size;
    const nextButton = findNextPageButton();
    if (nextButton) {
      clickElement(nextButton);
      state.scrollCount += 1;
      await sleep(2200);
    } else if (goNextPageByUrl()) {
      state.scrollCount += 1;
      await sleep(2200);
    } else {
      window.scrollBy({ top: Math.max(700, Math.floor(window.innerHeight * 0.85)), behavior: 'smooth' });
      state.scrollCount += 1;
      await sleep(1400);
    }
    captureJobsFromDom();
    if (state.capturedJobs.size > before) {
      state.emptyScrollBatches = 0;
      return true;
    }
    state.emptyScrollBatches += 1;
    log(T.noNewAfterLoad + ' ' + state.emptyScrollBatches + '/' + EMPTY_SCROLL_STOP_BATCHES, 'muted');
    return false;
  };

  const stopAutoApply = (reason) => {
    if (reason) state.stopReason = reason;
    state.running = false;
    updatePanel();
  };

  const resetRunCounters = () => {
    state.success = 0;
    state.failed = 0;
    state.skipped = 0;
    state.scanned = 0;
    state.scrollCount = 0;
    state.emptyScrollBatches = 0;
    state.processedKeys = new Set();
    state.stopReason = '';
    state.lastApplyNetworkEvent = null;
  };

  const startAutoApply = async () => {
    if (state.running) return;
    resetRunCounters();
    state.running = true;
    const runId = state.runId + 1;
    state.runId = runId;
    updatePanel();
    log(T.startRun, 'ok');

    while (state.running && state.runId === runId) {
      if (state.success >= settings.maxApply) {
        stopAutoApply(T.maxReached);
        break;
      }

      const job = getNextJob();
      if (!job) {
        if (!settings.autoLoadMore) {
          stopAutoApply(T.noPending);
          break;
        }
        await loadMoreOrScroll();
        if (state.emptyScrollBatches >= EMPTY_SCROLL_STOP_BATCHES) {
          stopAutoApply(T.noMore);
          break;
        }
        continue;
      }

      await processJob(job);
      if (state.running && state.success < settings.maxApply) {
        await sleep(randomDelay(settings.intervalSeconds * 1000));
      }
    }

    state.running = false;
    updatePanel();
    log(T.stopRun + (state.stopReason ? ' - ' + state.stopReason : ''), 'muted');
  };

  const init = () => {
    if (!document.body) {
      setTimeout(init, 100);
      return;
    }
    patchNetwork();
    createPanel();
    captureJobsFromDom();
  };

  init();
})();
