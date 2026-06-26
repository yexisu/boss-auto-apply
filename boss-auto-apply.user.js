// ==UserScript==
// @name         BOSS自动投递助手（无AI）
// @namespace    local.boss.auto.apply
// @version      1.2.11
// @description  BOSS直聘自动投递：接口投递、自动下滑加载、外包拦截、过滤不活跃Boss；不含AI、不连接第三方服务。
// @author       local
// @match        https://www.zhipin.com/web/geek/*
// @match        https://www.zhipin.com/overseas/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'boss_auto_apply_settings_v1';
  const CONTACT_HISTORY_KEY = 'boss_auto_apply_contact_history_v1';
  const CONTACT_HISTORY_MAX = 3000;
  const CONTACT_HISTORY_TTL = 1000 * 60 * 60 * 24 * 180;
  const EMPTY_SCROLL_STOP_BATCHES = 3;
  const FILTERED_EMPTY_SCROLL_STOP_BATCHES = 8;
  const END_REASONS = /上限|频繁|验证|安全|今日沟通人数|请稍后|风控|异常流量|登录/;
  const CONTACTED_REASONS = /继续沟通|已沟通|沟通过|已打招呼|已投递|已经.*沟通|已经.*打招呼/;
  const CONTACTED_BOOLEAN_FIELD_PATTERN = /^(?:is|has)?(?:friend|contact|contacted|communicated|greeted|greeting|conversation|chat)$/i;
  const CONTACTED_STATUS_FIELD_PATTERN = /(?:friend|contact|chat|relation|greet|\u6c9f\u901a|\u804a\u5929|\u4f1a\u8bdd|\u597d\u53cb|\u6253\u62db\u547c).*status|status.*(?:friend|contact|chat|relation|greet|\u6c9f\u901a|\u804a\u5929|\u4f1a\u8bdd|\u597d\u53cb|\u6253\u62db\u547c)/i;
  const JOB_API_HINT = /\/wapi\/zpgeek\/search\/joblist|\/wapi\/zpgeek\/recommend|\/wapi\/zpgeek\/job\/rec|\/wapi\/zpgeek\/job\/card|\/web\/geek\/job/i;

  const state = {
    running: false,
    scrollCount: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    scanned: 0,
    processedKeys: new Set(),
    capturedJobs: new Map(),
    runId: 0,
    currentRunStartedAt: 0,
    emptyScrollBatches: 0,
    lastFilteredSkipReason: '',
    stopReason: '',
  };

  const defaultSettings = {
    greeting: '您好，我看到贵司{company}正在招聘{title}，岗位方向和我的经历比较匹配，希望能有机会进一步沟通。',
    maxApply: 30,
    intervalSeconds: 4,
    autoSendGreeting: true,
    onlyForeignCompany: false,
    foreignKeywords: '外企,欧美,美国,欧洲,德国,法国,英国,瑞士,瑞典,荷兰,丹麦,芬兰,挪威,日本,韩国,新加坡,跨国公司,世界500强,Fortune,NASDAQ,NYSE,纳斯达克,纽交所,外资,合资,独资,代表处,办事处,中国区,亚太,APAC,MNC,Global,International',
    blockOutsourceCompany: false,
    outsourceKeywords: [
      '中软国际',
      '中科创达',
      '博彦科技',
      '软通动力',
      '文思海辉',
      '东软',
      '上海思芮',
      '科瑞',
      '高伟达',
      '中智',
      '外服',
      '中企人力',
      '易才',
      '蚂蚁HR',
      '紫川软件',
      '易思博',
      '麦亚信',
      '长亮',
      '京北方',
      '微创',
      '鼎驰',
      '拓保软件',
      '武汉佰钧成',
      '佰钧成',
      '博悦科创',
      '亿科达',
      '青柏信息',
      '博雅互动',
      '博奥特科技',
      '金证股份',
      '印孚瑟斯',
      'Infosys',
      '前海泰坦科技',
      '福瑞兰斯',
      'SapFreelance',
      '凌志软件',
      '法本信息',
      '柯莱特',
      '中科软',
      '浪潮软件',
      '亚信科技',
      '新致软件',
      'IBM外包',
      '北京外企德科',
      '外企德科',
      'FESCO Adecco',
      '德科信息',
      '海隆软件',
      '宇信科技',
      '汉德',
      '汉得',
      '科蓝',
      '亿迪',
      '海博拓天',
      '神马',
      '博朗',
      '中和软件',
      '亿达',
      '凯捷',
      'Capgemini',
      '埃森哲',
      'Accenture',
      '普华永道信息技术',
      '信必优',
      '润和',
      '神州数码',
      '信华信',
      '大连华信',
      '中电文思海辉',
      '中电金信',
      '项目外包',
      '人力外包',
      '软件外包',
      '外包',
      '外派',
      '驻场',
      '驻场开发',
      '劳务派遣',
      '派遣',
      'OD',
      'ODC',
      'ITO',
      'BPO',
    ].join(','),
    onlyActiveBoss: false,
    activeBossDays: 3,
    skipPreviouslyContacted: true,
    panelLeft: null,
    panelTop: null,
    panelCollapsed: false,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const randomDelay = (baseMs) => baseMs + Math.floor(Math.random() * Math.min(1500, Math.max(500, baseMs * 0.4)));

  const loadSettings = () => {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch (_) {
      return { ...defaultSettings };
    }
  };

  const settings = loadSettings();

  const saveSettings = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  };

  const parseKeywords = (value) => String(value || '')
    .split(/[\n,，;；|、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const formatKeywords = (value) => parseKeywords(value).join(',');

  const jobSearchText = (job) => {
    const rawText = (() => {
      try {
        return JSON.stringify(job.raw || {});
      } catch (_) {
        return '';
      }
    })();
    return [job.company, job.title, job.salary, job.area, job.extraText, rawText].filter(Boolean).join(' ').toLowerCase();
  };

  const foreignCompanyHit = (job) => {
    if (!settings.onlyForeignCompany) return null;
    const keywords = parseKeywords(settings.foreignKeywords);
    if (!keywords.length) return null;
    const target = jobSearchText(job);
    return keywords.find((keyword) => target.includes(keyword.toLowerCase())) || null;
  };

  const outsourceCompanyHit = (job) => {
    if (!settings.blockOutsourceCompany) return null;
    const keywords = parseKeywords(settings.outsourceKeywords);
    if (!keywords.length) return null;
    const target = jobSearchText(job);
    return keywords.find((keyword) => target.includes(keyword.toLowerCase())) || null;
  };

  const getCookie = (name) => {
    const escapedName = name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  };

  const safeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();


  const loadContactHistory = () => {
    try {
      const raw = JSON.parse(localStorage.getItem(CONTACT_HISTORY_KEY) || '{}');
      const now = Date.now();
      const entries = Object.entries(raw || {})
        .filter(([, record]) => record && Number.isFinite(Number(record.time)) && now - Number(record.time) <= CONTACT_HISTORY_TTL)
        .sort((a, b) => Number(b[1].time) - Number(a[1].time))
        .slice(0, CONTACT_HISTORY_MAX);
      return new Map(entries);
    } catch (_) {
      return new Map();
    }
  };

  const contactHistory = loadContactHistory();

  const saveContactHistory = () => {
    try {
      const entries = [...contactHistory.entries()]
        .sort((a, b) => Number(b[1].time) - Number(a[1].time))
        .slice(0, CONTACT_HISTORY_MAX);
      contactHistory.clear();
      entries.forEach(([key, record]) => contactHistory.set(key, record));
      localStorage.setItem(CONTACT_HISTORY_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (_) {}
  };

  const historyPart = (value) => safeText(value).toLowerCase();

  const contactHistoryKeys = (job) => {
    const keys = new Set();
    if (job.encryptJobId) keys.add(`job:${job.encryptJobId}`);
    if (job.securityId && job.encryptJobId) keys.add(`security-job:${job.securityId}:${job.encryptJobId}`);
    if (job.encryptBossId && job.encryptJobId) keys.add(`boss-job:${job.encryptBossId}:${job.encryptJobId}`);
    if (job.company && job.title && job.encryptBossId) {
      keys.add(`boss-title:${job.encryptBossId}:${historyPart(job.company)}:${historyPart(job.title)}`);
    }
    return [...keys];
  };

  const findContactHistory = (job) => contactHistoryKeys(job)
    .map((key) => ({ key, record: contactHistory.get(key) }))
    .find((item) => item.record) || null;

  const rememberContactedJob = (job, reason = '\u5df2\u6c9f\u901a') => {
    const keys = contactHistoryKeys(job);
    if (!keys.length) return;
    const record = {
      time: Date.now(),
      reason: safeText(reason),
      title: job.title || '',
      company: job.company || '',
      boss: job.encryptBossId || '',
      job: job.encryptJobId || '',
    };
    keys.forEach((key) => contactHistory.set(key, record));
    saveContactHistory();
  };

  const clearContactHistory = () => {
    contactHistory.clear();
    try {
      localStorage.removeItem(CONTACT_HISTORY_KEY);
    } catch (_) {}
  };

  const extractContactedSignal = (raw) => {
    let found = '';
    const seen = new WeakSet();

    const visit = (value, depth = 0, key = '') => {
      if (found || value == null || depth > 6) return;
      if (typeof value === 'string' || typeof value === 'number') {
        const text = safeText(value);
        if (text && CONTACTED_REASONS.test(text)) {
          found = text;
          return;
        }
        if (Number(value) === 1 && CONTACTED_STATUS_FIELD_PATTERN.test(key)) {
          found = `${key}=1`;
        }
        return;
      }
      if (typeof value === 'boolean') {
        if (value === true && CONTACTED_BOOLEAN_FIELD_PATTERN.test(key)) found = `${key}=true`;
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);

      Object.entries(value).some(([childKey, childValue]) => {
        visit(childValue, depth + 1, childKey);
        return Boolean(found);
      });
    };

    visit(raw);
    return found;
  };

  const ACTIVE_FIELD_PATTERN = /active|online|lastlogin|lastactive|bossactive|bossonline|活跃|在线/i;
  const ACTIVE_TEXT_PATTERN = /(不在线|离线|不活跃|很久未活跃|刚刚在线|当前在线|在线|刚刚活跃|今日活跃|今天活跃|近期活跃|最近活跃|\d+\s*(?:秒|分钟|小时|天|日|周|月|年)(?:前|内)?(?:活跃|在线)?|[一二三四五六七八九十两]+\s*(?:秒|分钟|小时|天|日|周|月|年)(?:前|内)?(?:活跃|在线)?|本周活跃|本月活跃)/;

  const extractActiveTextFromRaw = (raw) => {
    let found = '';
    const seen = new WeakSet();

    const visit = (value, depth = 0, key = '') => {
      if (found || value == null || depth > 5) return;
      if (typeof value === 'string' || typeof value === 'number') {
        const text = safeText(value);
        if (ACTIVE_FIELD_PATTERN.test(key) && text) found = text;
        return;
      }
      if (typeof value === 'boolean') {
        if (ACTIVE_FIELD_PATTERN.test(key) && value === true) found = '在线';
        return;
      }
      if (typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);

      Object.entries(value).some(([childKey, childValue]) => {
        visit(childValue, depth + 1, childKey);
        return Boolean(found);
      });
    };

    visit(raw);
    return found;
  };

  const extractActiveTextFromCard = (card) => {
    const candidates = [
      ...card.querySelectorAll('[class*="active"], [class*="online"], [class*="boss"], [class*="time"], [class*="tag"]'),
      card,
    ];

    for (const element of candidates) {
      const text = safeText(element.textContent);
      if (!text) continue;
      const match = text.match(ACTIVE_TEXT_PATTERN);
      if (match) return safeText(match[0]);
    }
    return '';
  };

  const getPageUid = () => window._PAGE?.uid || window.__PAGE__?.uid || '';

  const jobKeyOf = (job) => [job.securityId, job.encryptJobId, job.lid].filter(Boolean).join(':');

  const normalizeJob = (raw, source = 'unknown') => {
    if (!raw || typeof raw !== 'object') return null;

    const securityId = raw.securityId || raw.security_id || raw.secId || raw.jobSecurityId || '';
    const encryptJobId = raw.encryptJobId || raw.encryptJobID || raw.jobId || raw.encryptId || raw.encryptJobid || '';
    const lid = raw.lid || raw.listId || raw.traceId || raw.jobLid || '';
    const encryptBossId = raw.encryptBossId || raw.encryptBossID || raw.bossId || raw.encryptUid || raw.encryptUserId || raw.bossEncryptId || '';
    const title = safeText(raw.jobName || raw.jobTitle || raw.positionName || raw.title || raw.name || raw.encryptJobId || encryptJobId || '未知职位');
    const company = safeText(raw.brandName || raw.companyName || raw.encryptBrandId || raw.brand || raw.company || '');
    const salary = safeText(raw.salaryDesc || raw.salary || '');
    const area = safeText([raw.cityName, raw.areaDistrict, raw.businessDistrict].filter(Boolean).join(' '));
    const extraText = safeText([
      raw.brandIndustry,
      raw.industryName,
      raw.industry,
      raw.brandStageName,
      raw.stageName,
      raw.financeStage,
      raw.scaleName,
      raw.brandScaleName,
      raw.companyScale,
      raw.brandScale,
      raw.brandLabels,
      raw.companyLabels,
      raw.labels,
      raw.welfareList,
      raw.tags,
      raw.actionText,
    ].filter(Boolean).join(' '));
    const friendStatus = Number(raw.friendStatus ?? raw.chatStatus ?? raw.relationStatus ?? 0);
    const contactedText = safeText([raw.statusText, raw.actionText, raw.btnText, raw.buttonText, raw.chatText].filter(Boolean).join(' '));
    const contactedSignal = extractContactedSignal(raw);
    const contacted = raw.contact === true || friendStatus === 1 || CONTACTED_REASONS.test(contactedText) || Boolean(contactedSignal);
    const activeText = extractActiveTextFromRaw(raw);

    if (!securityId || !encryptJobId || !lid) return null;

    return {
      key: [securityId, encryptJobId, lid].join(':'),
      securityId,
      encryptJobId,
      lid,
      encryptBossId,
      title,
      company,
      salary,
      area,
      extraText,
      contacted,
      contactedText: contactedSignal || contactedText,
      activeText,
      source,
      raw,
    };
  };

  const storeJob = (job) => {
    if (!job?.key) return false;
    const existing = state.capturedJobs.get(job.key);
    if (!existing) {
      state.capturedJobs.set(job.key, job);
      return true;
    }

    state.capturedJobs.set(job.key, {
      ...existing,
      ...job,
      securityId: job.securityId || existing.securityId,
      encryptJobId: job.encryptJobId || existing.encryptJobId,
      lid: job.lid || existing.lid,
      encryptBossId: job.encryptBossId || existing.encryptBossId,
      title: job.title && job.title !== '未知职位' ? job.title : existing.title,
      company: job.company || existing.company,
      salary: job.salary || existing.salary,
      area: job.area || existing.area,
      contacted: existing.contacted || job.contacted,
      contactedText: job.contactedText || existing.contactedText,
      extraText: [existing.extraText, job.extraText].filter(Boolean).join(' '),
      activeText: job.activeText || existing.activeText,
      raw: { ...(existing.raw || {}), ...(job.raw || {}) },
    });
    return false;
  };

  const visitObject = (value, visitor, depth = 0, seen = new WeakSet()) => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      visitor(value);
      value.forEach((item) => visitObject(item, visitor, depth + 1, seen));
      return;
    }

    visitObject(Object.values(value), visitor, depth + 1, seen);
  };

  const captureJobsFromPayload = (payload, source = 'api') => {
    let count = 0;
    visitObject(payload, (array) => {
      array.forEach((item) => {
        const job = normalizeJob(item, source);
        if (job && storeJob(job)) {
          count += 1;
        }
      });
    });
    if (count > 0) {
      log(`从接口捕获 ${count} 个职位`, 'info');
      updateStatus();
    }
  };

  const patchFetch = () => {
    if (!window.fetch || window.fetch.__bossAutoApplyPatched) return;
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const url = String(args[0]?.url || args[0] || '');
        if (JOB_API_HINT.test(url)) {
          response.clone().json().then((data) => captureJobsFromPayload(data, `fetch:${url}`)).catch(() => {});
        }
      } catch (_) {}
      return response;
    };
    window.fetch.__bossAutoApplyPatched = true;
  };

  const patchXhr = () => {
    if (XMLHttpRequest.prototype.__bossAutoApplyPatched) return;
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__bossAutoApplyUrl = String(url || '');
      return originalOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function patchedSend(...args) {
      this.addEventListener('load', function onLoad() {
        try {
          if (JOB_API_HINT.test(this.__bossAutoApplyUrl || '') && typeof this.responseText === 'string') {
            captureJobsFromPayload(JSON.parse(this.responseText), `xhr:${this.__bossAutoApplyUrl}`);
          }
        } catch (_) {}
      });
      return originalSend.apply(this, args);
    };

    XMLHttpRequest.prototype.__bossAutoApplyPatched = true;
  };

  const readVueData = (element) => {
    let current = element;
    while (current) {
      if (current.__vue__?.data) return current.__vue__.data;
      if (current.__vue__?.source) return current.__vue__.source;
      if (current.__vueParentComponent?.props) return current.__vueParentComponent.props;
      if (current.__vnode?.props) return current.__vnode.props;
      current = current.parentElement;
    }
    return null;
  };

  const parseJobFromLink = (card) => {
    const link = card.querySelector('a[href*="/job_detail/"]') || card.closest('a[href*="/job_detail/"]');
    if (!link) return null;
    const url = new URL(link.href, location.origin);
    const jobIdFromPath = url.pathname.match(/\/job_detail\/([^/?#]+)/)?.[1] || '';
    const raw = {
      securityId: url.searchParams.get('securityId') || card.dataset.securityId || '',
      encryptJobId: jobIdFromPath || card.dataset.jobId || '',
      lid: url.searchParams.get('lid') || card.dataset.lid || '',
      jobName: card.querySelector('.job-name, .job-title, .job-card-left a, [class*="job-name"], [class*="job-title"]')?.textContent,
      brandName: card.querySelector('.company-name, [class*="company-name"], [class*="brand-name"]')?.textContent,
      salaryDesc: card.querySelector('.salary, [class*="salary"]')?.textContent,
      actionText: card.textContent,
      labels: card.textContent,
      activeTimeDesc: extractActiveTextFromCard(card),
    };
    return normalizeJob(raw, 'dom-link');
  };

  const scanDomJobs = () => {
    const selectors = [
      '.job-card-wrapper',
      '.job-card-wrap',
      '.job-card-box',
      '.job-list-box li',
      '.rec-job-list .job-card-box',
      '[ka^="job_list_"]',
      'li:has(a[href*="/job_detail/"])',
      'div:has(a[href*="/job_detail/"])',
    ];
    const elements = [];
    selectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((element) => elements.push(element));
      } catch (_) {}
    });

    let added = 0;
    [...new Set(elements)].forEach((element) => {
      const job = normalizeJob(readVueData(element), 'dom-vue') || parseJobFromLink(element);
      if (job && storeJob(job)) {
        added += 1;
      }
    });

    if (added > 0) {
      log(`从页面扫描 ${added} 个职位`, 'info');
    }
    state.scanned = state.capturedJobs.size;
    updateStatus();
    return [...state.capturedJobs.values()];
  };

  const chineseNumberValue = (value) => {
    const text = safeText(value);
    if (!text) return null;
    if (text === '\u534a') return 0.5;
    const digits = {
      '\u4e00': 1,
      '\u4e8c': 2,
      '\u4e24': 2,
      '\u4e09': 3,
      '\u56db': 4,
      '\u4e94': 5,
      '\u516d': 6,
      '\u4e03': 7,
      '\u516b': 8,
      '\u4e5d': 9,
    };
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

  const fetchJobDetail = async (job) => {
    if (!job.securityId || !job.lid) return null;
    const url = `https://www.zhipin.com/wapi/zpgeek/job/card.json?lid=${encodeURIComponent(job.lid)}&securityId=${encodeURIComponent(job.securityId)}&sessionId=`;
    const response = await fetch(url, { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    return data.zpData?.jobCard || data.zpData || data.data || null;
  };

  const isActiveBoss = async (job) => {
    const direct = isActiveText(job.activeText);
    if (direct !== null) return { active: direct, text: job.activeText || '列表活跃信息' };

    try {
      const detail = await fetchJobDetail(job);
      const detailText = extractActiveTextFromRaw(detail);
      const detailActive = isActiveText(detailText);
      if (detailActive !== null) return { active: detailActive, text: detailText };
    } catch (error) {
      return { active: false, text: `活跃度查询失败：${error.message}` };
    }

    return { active: false, text: '无活跃度信息' };
  };

  const applyJob = async (job) => {
    const token = getCookie('bst');
    const url = `https://www.zhipin.com/wapi/zpgeek/friend/add.json?securityId=${encodeURIComponent(job.securityId)}&jobId=${encodeURIComponent(job.encryptJobId)}&lid=${encodeURIComponent(job.lid)}`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Zp_token: token,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (data.code === 0 || data.message === 'Success') return data;
    const message = data.message || data?.zpData?.bizData?.chatRemindDialog?.content || JSON.stringify(data);
    throw new Error(message || '投递失败');
  };

  const fetchBossData = async (job) => {
    const token = getCookie('bst');
    const data = new FormData();
    data.append('bossId', job.encryptBossId || job.raw?.encryptBossId || '');
    data.append('securityId', job.securityId);
    data.append('bossSrc', '0');
    const response = await fetch('https://www.zhipin.com/wapi/zpchat/geek/getBossData', {
      method: 'POST',
      credentials: 'include',
      headers: { Zp_token: token },
      body: data,
    });
    const json = await response.json().catch(() => ({}));
    if (json.code !== 0) throw new Error(json.message || '获取Boss联系人失败');
    return json.zpData?.data || json.zpData || json.data;
  };

  const mergeJobContactDetail = (job, detail) => {
    if (!detail || typeof detail !== 'object') return '';
    const normalized = normalizeJob({ ...(job.raw || {}), ...detail }, 'detail-contact-check');
    if (normalized) {
      job.encryptBossId = job.encryptBossId || normalized.encryptBossId;
      job.contacted = job.contacted || normalized.contacted;
      job.contactedText = normalized.contactedText || job.contactedText;
      job.raw = { ...(job.raw || {}), ...(normalized.raw || {}) };
      storeJob(job);
    }
    return extractContactedSignal(detail);
  };

  const assignBossIdentity = (job, bossData) => {
    const encryptBossId = bossData?.encryptBossId || bossData?.encryptUid || bossData?.encryptFriendId || '';
    if (encryptBossId && !job.encryptBossId) job.encryptBossId = String(encryptBossId);
    if (job.raw && encryptBossId && !job.raw.encryptBossId) job.raw.encryptBossId = String(encryptBossId);
  };

  const hasJobChatEvidence = (job, data) => {
    const text = (() => {
      try {
        return JSON.stringify(data || {});
      } catch (_) {
        return '';
      }
    })();
    if (!text) return false;
    if (job.encryptJobId && text.includes(job.encryptJobId)) return true;
    if (job.securityId && text.includes(job.securityId)) return true;
    if (job.title && job.title !== '\u672a\u77e5\u804c\u4f4d' && text.includes(job.title)) return true;
    return false;
  };

  const checkPreviouslyContacted = async (job) => {
    if (!settings.skipPreviouslyContacted) return { contacted: false };

    const history = findContactHistory(job);
    if (history) {
      return { contacted: true, reason: history.record.reason || '\u672c\u5730\u5386\u53f2\u8bb0\u5f55', source: 'local' };
    }

    if (job.contacted) {
      const reason = job.contactedText || '\u5c97\u4f4d\u5217\u8868\u663e\u793a\u5df2\u6c9f\u901a';
      rememberContactedJob(job, reason);
      return { contacted: true, reason, source: 'list' };
    }

    const rawSignal = extractContactedSignal(job.raw);
    if (rawSignal) {
      rememberContactedJob(job, rawSignal);
      return { contacted: true, reason: rawSignal, source: 'raw' };
    }

    if (!job.encryptBossId && !job.raw?.encryptBossId) {
      try {
        const detail = await fetchJobDetail(job);
        const detailSignal = mergeJobContactDetail(job, detail);
        if (detailSignal) {
          rememberContactedJob(job, detailSignal);
          return { contacted: true, reason: detailSignal, source: 'detail' };
        }
      } catch (_) {}
    }

    if (!job.encryptBossId && !job.raw?.encryptBossId) return { contacted: false };

    try {
      const bossData = await fetchBossData(job);
      assignBossIdentity(job, bossData);
      const bossSignal = extractContactedSignal(bossData);
      const hasEvidence = hasJobChatEvidence(job, bossData);
      if (bossSignal && hasEvidence) {
        rememberContactedJob(job, bossSignal);
        return { contacted: true, reason: bossSignal, source: 'chat' };
      }
      if (bossSignal && CONTACTED_REASONS.test(bossSignal)) {
        rememberContactedJob(job, bossSignal);
        return { contacted: true, reason: bossSignal, source: 'chat' };
      }
    } catch (error) {
      const message = error?.message || '';
      if (/非好友关系|不是好友|not\s+friend|non[-\s]?friend/i.test(message)) {
        return { contacted: false };
      }
      return { contacted: false, warning: message };
    }

    return { contacted: false };
  };

  const getSocketConnect = () => {
    try {
      return window.GeekChatCore?.getInstance?.()?.socketConnect;
    } catch (_) {
      return null;
    }
  };

  const buildGreeting = (job) => {
    const fallbackTitle = job.title && job.title !== '未知职位' ? job.title : '这个岗位';
    const variables = {
      title: fallbackTitle,
      job: fallbackTitle,
      company: job.company || '贵司',
      salary: job.salary || '',
      area: job.area || '',
    };
    const template = safeText(settings.greeting) || defaultSettings.greeting;
    const message = template.replace(/\{(title|job|company|salary|area)\}/g, (_, key) => variables[key] || '');
    return safeText(message).replace(/贵司贵司/g, '贵司');
  };

  const sendGreeting = async (job) => {
    const greeting = buildGreeting(job);
    if (!settings.autoSendGreeting || !greeting) return { skipped: true, reason: '未启用招呼语' };

    const bossData = await fetchBossData(job);
    assignBossIdentity(job, bossData);
    const user = {
      uid: Number(bossData.bossId || bossData.uid || bossData.friendId),
      friendSource: Number(bossData.friendSource || bossData.source || 0),
      encryptUid: String(bossData.encryptBossId || bossData.encryptUid || bossData.encryptFriendId || job.encryptBossId || ''),
      securityId: job.securityId,
      encryptJobId: job.encryptJobId,
      jobTitle: job.title,
    };

    if (!user.uid || !user.encryptUid) throw new Error('Boss联系人数据不完整');

    const socketConnect = getSocketConnect();
    if (socketConnect?.sendMessage) {
      socketConnect.sendMessage(user, greeting, 'text');
      return { sent: true, mode: 'sendMessage', greeting };
    }
    if (socketConnect?.sendTextMessage) {
      socketConnect.sendTextMessage(user, greeting);
      return { sent: true, mode: 'sendTextMessage', greeting };
    }

    throw new Error('页面聊天SDK不可用，无法发送招呼语');
  };

  const scrollForMoreJobs = async (shouldContinue = () => state.running) => {
    const beforeSize = state.capturedJobs.size;
    let lastY = window.scrollY;

    for (let index = 0; index < 5; index += 1) {
      if (!shouldContinue()) return false;
      window.scrollBy(0, Math.floor(window.innerHeight * 0.75));
      state.scrollCount += 1;
      updateStatus();
      await sleep(500);
      scanDomJobs();
      const hasPending = [...state.capturedJobs.values()].some((job) => !state.processedKeys.has(job.key));
      if (hasPending) return true;
      if (state.capturedJobs.size > beforeSize) return true;
      if (Math.abs(window.scrollY - lastY) < 10 && index > 1) break;
      lastY = window.scrollY;
    }

    return false;
  };

  const nextPendingJob = () => {
    scanDomJobs();
    return [...state.capturedJobs.values()].find((job) => !state.processedKeys.has(job.key));
  };

  const stop = (reason = '已停止') => {
    if (state.running) state.runId += 1;
    state.running = false;
    state.stopReason = reason;
    log(reason, reason.includes('停止') ? 'warn' : 'info');
    updateStatus();
  };

  const run = async () => {
    if (state.running) return;
    syncSettingsFromPanel();
    state.running = true;
    state.scrollCount = 0;
    state.success = 0;
    state.failed = 0;
    state.skipped = 0;
    state.processedKeys.clear();
    state.capturedJobs.clear();
    state.scanned = 0;
    state.emptyScrollBatches = 0;
    state.lastFilteredSkipReason = '';
    state.runId += 1;
    const runId = state.runId;
    const isCurrentRun = () => state.running && state.runId === runId;
    state.currentRunStartedAt = Date.now();
    state.stopReason = '';
    updateStatus();

    log('\u5df2\u70b9\u51fb\u5f00\u59cb\u6295\u9012\uff0c\u6b63\u5728\u521d\u59cb\u5316\u672c\u8f6e\u6295\u9012\u3002\u8bf7\u4fdd\u6301\u5f53\u524d BOSS \u9875\u9762\u6253\u5f00\u3002', 'info');
    scanDomJobs();

    while (isCurrentRun() && state.success < settings.maxApply) {
      let job = nextPendingJob();

      if (!job) {
        const loadedMore = await scrollForMoreJobs(isCurrentRun);
        if (!isCurrentRun()) break;
        if (loadedMore) {
          state.emptyScrollBatches = 0;
          job = nextPendingJob();
          if (job) {
            log('已向下滚动加载更多岗位，继续投递。', 'info');
          }
        }
      }

      if (!job) {
        state.emptyScrollBatches += 1;
        const emptyLimit = state.lastFilteredSkipReason ? FILTERED_EMPTY_SCROLL_STOP_BATCHES : EMPTY_SCROLL_STOP_BATCHES;
        if (state.emptyScrollBatches >= emptyLimit) {
          const reason = state.lastFilteredSkipReason
            ? `连续下滑仍未找到新的可投岗位（最近跳过：${state.lastFilteredSkipReason}），投递结束`
            : '连续下滑没有发现新的待投岗位，投递结束';
          stop(reason);
          break;
        }
        if (state.lastFilteredSkipReason && state.emptyScrollBatches >= EMPTY_SCROLL_STOP_BATCHES) {
          log(`刚才因${state.lastFilteredSkipReason}跳过岗位，继续向下加载寻找可投岗位。`, 'info');
        } else {
          log('当前可见区域没有待投岗位，继续向下加载。', 'info');
        }
        await sleep(600);
        continue;
      }

      state.emptyScrollBatches = 0;

      state.processedKeys.add(job.key);

      const outsourceKeyword = outsourceCompanyHit(job);
      if (outsourceKeyword) {
        state.skipped += 1;
        state.lastFilteredSkipReason = '\u5916\u5305\u62e6\u622a';
        log(`跳过外包公司/外包岗位【${outsourceKeyword}】：${formatJob(job)}`, 'warn');
        updateStatus();
        continue;
      }

      const foreignKeyword = foreignCompanyHit(job);
      if (settings.onlyForeignCompany && !foreignKeyword) {
        state.skipped += 1;
        state.lastFilteredSkipReason = '\u975e\u5916\u4f01\u8fc7\u6ee4';
        log(`跳过非外企/未命中外企关键词：${formatJob(job)}`, 'warn');
        updateStatus();
        continue;
      }
      if (foreignKeyword) {
        log(`命中外企关键词【${foreignKeyword}】：${formatJob(job)}`, 'info');
      }

      const contactedResult = await checkPreviouslyContacted(job);
      if (!isCurrentRun()) break;
      if (contactedResult.contacted) {
        state.skipped += 1;
        state.lastFilteredSkipReason = '\u5386\u53f2\u6c9f\u901a';
        log(`\u8df3\u8fc7\u91cd\u590d\u5c97\u4f4d\u3010\u4e0a\u6b21\u8bb0\u5f55\uff1a${contactedResult.reason}\u3011\uff1a${formatJob(job)}`, 'warn');
        updateStatus();
        continue;
      }
      if (contactedResult.warning) {
        log(`\u5386\u53f2\u6c9f\u901a\u68c0\u67e5\u5931\u8d25\uff0c\u7ee7\u7eed\u5c1d\u8bd5\u6295\u9012\uff1a${contactedResult.warning}`, 'warn');
      }

      if (settings.onlyActiveBoss) {
        const activeResult = await isActiveBoss(job);
        if (!isCurrentRun()) break;
        if (!activeResult.active) {
          state.skipped += 1;
          state.lastFilteredSkipReason = 'Boss\u4e0d\u6d3b\u8dc3';
          log(`跳过不活跃Boss【${activeResult.text}】：${formatJob(job)}`, 'warn');
          updateStatus();
          continue;
        }
        log(`Boss近期活跃【${activeResult.text}】：${formatJob(job)}`, 'info');
      }

      state.lastFilteredSkipReason = '';

      try {
        log(`投递中：${formatJob(job)}`, 'info');
        await applyJob(job);
        if (!isCurrentRun()) break;
        rememberContactedJob(job, '\u6295\u9012\u6210\u529f');
        state.success += 1;
        log(`投递成功：${formatJob(job)}`, 'success');

        try {
          const result = await sendGreeting(job);
          if (!isCurrentRun()) break;
          if (result?.sent) log(`招呼语已发送：${formatJob(job)}｜${result.greeting}`, 'success');
        } catch (error) {
          log(`招呼语发送失败：${error.message}`, 'warn');
        }
      } catch (error) {
        if (CONTACTED_REASONS.test(error.message)) {
          state.skipped += 1;
          state.lastFilteredSkipReason = '\u5df2\u6c9f\u901a';
          rememberContactedJob(job, error.message);
          log(`投递返回已打招呼/已沟通，已跳过：${formatJob(job)}；原因：${error.message}`, 'warn');
          updateStatus();
          continue;
        }
        state.failed += 1;
        log(`投递失败：${formatJob(job)}；原因：${error.message}`, 'error');
        if (END_REASONS.test(error.message)) {
          stop(`疑似触发限制，已停止：${error.message}`);
          break;
        }
      }

      updateStatus();
      await sleep(randomDelay(settings.intervalSeconds * 1000));
    }

    if (isCurrentRun()) {
      stop(`达到最大投递数 ${settings.maxApply}，投递结束`);
    }
  };

  const formatJob = (job) => [job.title, job.company, job.salary, job.area].filter(Boolean).join(' / ');

  const log = (message, type = 'info') => {
    const list = document.querySelector('#boss-auto-apply-log');
    if (!list) return;
    const item = document.createElement('div');
    item.className = `boss-auto-apply-log-item ${type}`;
    item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    list.prepend(item);
    while (list.children.length > 120) list.lastElementChild.remove();
  };

  const updateStatus = () => {
    const status = document.querySelector('#boss-auto-apply-status');
    const toggle = document.querySelector('#boss-auto-apply-toggle');
    const stopButton = document.querySelector('#boss-auto-apply-stop');
    if (status) {
      status.textContent = `\u5df2\u4e0b\u6ed1 ${state.scrollCount} \u6b21\uff5c\u6355\u83b7 ${state.capturedJobs.size}\uff5c\u6210\u529f ${state.success}/${settings.maxApply}\uff5c\u5931\u8d25 ${state.failed}\uff5c\u8df3\u8fc7 ${state.skipped}`;
    }
    if (toggle) {
      toggle.textContent = state.running ? '\u6295\u9012\u4e2d...' : '\u5f00\u59cb\u6295\u9012';
      toggle.disabled = state.running;
      toggle.classList.toggle('running', state.running);
    }
    if (stopButton) {
      stopButton.disabled = !state.running;
    }
  };

  const updateActiveDaysInputState = () => {
    const onlyActiveBoss = document.querySelector('#boss-auto-apply-only-active');
    const activeBossDays = document.querySelector('#boss-auto-apply-active-days');
    if (!activeBossDays) return;
    const disabled = onlyActiveBoss?.checked !== true;
    activeBossDays.disabled = disabled;
    activeBossDays.closest('.boss-auto-field')?.classList.toggle('is-disabled', disabled);
    activeBossDays.title = disabled ? '\u5f00\u542f\u8fc7\u6ee4\u4e0d\u6d3b\u8dc3Boss\u540e\u53ef\u7f16\u8f91' : '';
  };

  const syncSettingsFromPanel = () => {
    const greeting = document.querySelector('#boss-auto-apply-greeting');
    const maxApply = document.querySelector('#boss-auto-apply-max');
    const interval = document.querySelector('#boss-auto-apply-interval');
    const autoGreeting = document.querySelector('#boss-auto-apply-auto-greeting');
    const onlyForeignCompany = document.querySelector('#boss-auto-apply-only-foreign');
    const foreignKeywords = document.querySelector('#boss-auto-apply-foreign-keywords');
    const blockOutsourceCompany = document.querySelector('#boss-auto-apply-block-outsource');
    const outsourceKeywords = document.querySelector('#boss-auto-apply-outsource-keywords');
    const onlyActiveBoss = document.querySelector('#boss-auto-apply-only-active');
    const activeBossDays = document.querySelector('#boss-auto-apply-active-days');
    const skipPreviouslyContacted = document.querySelector('#boss-auto-apply-skip-contacted');

    settings.greeting = greeting?.value || defaultSettings.greeting;
    settings.maxApply = Math.max(1, Math.min(200, Number(maxApply?.value) || defaultSettings.maxApply));
    settings.intervalSeconds = Math.max(1, Math.min(60, Number(interval?.value) || defaultSettings.intervalSeconds));
    const activeBossDaysValue = Number(activeBossDays?.value);
    settings.autoSendGreeting = autoGreeting?.checked !== false;
    settings.onlyForeignCompany = onlyForeignCompany?.checked === true;
    settings.foreignKeywords = formatKeywords(foreignKeywords?.value || defaultSettings.foreignKeywords);
    settings.blockOutsourceCompany = blockOutsourceCompany?.checked === true;
    settings.outsourceKeywords = formatKeywords(outsourceKeywords?.value || defaultSettings.outsourceKeywords);
    settings.onlyActiveBoss = onlyActiveBoss?.checked === true;
    settings.activeBossDays = Number.isFinite(activeBossDaysValue) ? Math.max(0, Math.min(365, activeBossDaysValue)) : defaultSettings.activeBossDays;
    updateActiveDaysInputState();
    settings.skipPreviouslyContacted = skipPreviouslyContacted?.checked !== false;
    saveSettings();
    updateStatus();
  };

  const mountPanel = () => {
    if (document.querySelector('#boss-auto-apply-panel')) return;

    const style = document.createElement('style');
    style.textContent = `
      #boss-auto-apply-panel { position: fixed; right: 22px; top: 72px; z-index: 2147483647; width: 520px; max-height: min(88vh, 900px); display: flex; flex-direction: column; border-radius: 20px; background: rgba(255,255,255,.97); backdrop-filter: blur(14px); border: 1px solid rgba(0,179,138,.18); box-shadow: 0 18px 48px rgba(15,23,42,.18); color: #1f2933; font-size: 14px; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Microsoft YaHei",sans-serif; overflow: hidden; transition: width .16s ease, box-shadow .16s ease, transform .16s ease; }
      #boss-auto-apply-panel * { box-sizing: border-box; }
      #boss-auto-apply-panel.is-dragging { transition: none; box-shadow: 0 22px 58px rgba(15,23,42,.24); }
      #boss-auto-apply-panel.is-collapsed { width: 218px; max-height: none; border-radius: 999px; }
      #boss-auto-apply-panel.is-collapsed .boss-auto-body { display: none; }
      #boss-auto-apply-panel.is-collapsed .boss-auto-header { padding: 10px 12px; border-bottom: 0; }
      #boss-auto-apply-panel.is-collapsed .boss-auto-subtitle, #boss-auto-apply-panel.is-collapsed .boss-auto-status { display: none; }
      #boss-auto-apply-panel.is-collapsed h3 { font-size: 14px; }
      #boss-auto-apply-panel .boss-auto-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 15px; background: linear-gradient(135deg, #f0fffa 0%, #f8fbff 100%); border-bottom: 1px solid #e8f3ef; cursor: move; user-select: none; touch-action: none; }
      #boss-auto-apply-panel .boss-auto-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
      #boss-auto-apply-panel .boss-auto-logo { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-weight: 900; background: linear-gradient(135deg, #00b38a, #00d0a0); box-shadow: 0 5px 13px rgba(0,179,138,.26); }
      #boss-auto-apply-panel h3 { margin: 0; font-size: 16px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #boss-auto-apply-panel .boss-auto-subtitle { margin-top: 3px; color: #7a8794; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #boss-auto-apply-panel .boss-auto-head-actions { display: flex; align-items: center; gap: 8px; }
      #boss-auto-apply-panel .boss-auto-collapse { width: 30px; height: 30px; border: 0; border-radius: 9px; background: #e8f8f3; color: #087f5b; cursor: pointer; font-weight: 800; }
      #boss-auto-apply-panel .boss-auto-body { padding: 14px; overflow: auto; }
      #boss-auto-apply-panel .boss-auto-status { color: #0f766e; background: #e8f8f3; border: 1px solid #c6eee2; border-radius: 999px; padding: 7px 10px; margin-bottom: 12px; font-size: 12px; line-height: 1.35; }
      #boss-auto-apply-panel .boss-auto-card { background: #fff; border: 1px solid #edf2f7; border-radius: 14px; padding: 11px; margin-bottom: 10px; }
      #boss-auto-apply-panel .boss-auto-card-title { margin: 0 0 9px; font-weight: 800; color: #26323f; }
      #boss-auto-apply-panel textarea { width: 100%; min-height: 96px; resize: vertical; padding: 10px 11px; border: 1px solid #d9e2ec; border-radius: 10px; outline: none; line-height: 1.55; background: #fff; color: #1f2933; transition: border-color .15s, box-shadow .15s; }
      #boss-auto-apply-panel textarea + textarea { margin-top: 8px; }
      #boss-auto-apply-panel textarea:focus, #boss-auto-apply-panel input:focus { border-color: #00b38a; box-shadow: 0 0 0 3px rgba(0,179,138,.12); }
      #boss-auto-apply-panel .boss-auto-inline-actions { display: flex; justify-content: flex-end; margin-top: 7px; }
      #boss-auto-apply-panel .boss-auto-link-button { border: 0; border-radius: 999px; padding: 6px 10px; background: #e8f8f3; color: #087f5b; cursor: pointer; font-size: 12px; font-weight: 800; }
      #boss-auto-apply-panel .boss-auto-link-button:hover { background: #d7f3eb; }
      #boss-auto-apply-panel .boss-auto-controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin-top: 10px; }
      #boss-auto-apply-panel .boss-auto-controls-two { grid-template-columns: repeat(2, 1fr); }
      #boss-auto-apply-panel .boss-auto-field label { display: block; margin-bottom: 5px; color: #66788a; font-size: 12px; }
      #boss-auto-apply-panel input[type="number"] { width: 100%; padding: 8px 9px; border: 1px solid #d9e2ec; border-radius: 10px; outline: none; background: #fff; }
      #boss-auto-apply-panel .boss-auto-field.is-disabled label { color: #a0aec0; }
      #boss-auto-apply-panel .boss-auto-field.is-disabled input { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; border-color: #e2e8f0; }
      #boss-auto-apply-panel .boss-auto-switches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
      #boss-auto-apply-panel .boss-auto-check { min-height: 38px; padding: 0 10px; border: 1px solid #d9e2ec; border-radius: 12px; background: #fbfdff; color: #405261; }
      #boss-auto-apply-panel .boss-auto-switch { position: relative; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
      #boss-auto-apply-panel .boss-auto-switch input { position: absolute; opacity: 0; pointer-events: none; }
      #boss-auto-apply-panel .boss-auto-switch-ui { position: relative; flex: 0 0 auto; width: 36px; height: 20px; border-radius: 999px; background: #cbd5e1; transition: background .15s; }
      #boss-auto-apply-panel .boss-auto-switch-ui::after { content: ""; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(15,23,42,.22); transition: transform .15s; }
      #boss-auto-apply-panel .boss-auto-switch input:checked + .boss-auto-switch-ui { background: #00b38a; }
      #boss-auto-apply-panel .boss-auto-switch input:checked + .boss-auto-switch-ui::after { transform: translateX(16px); }
      #boss-auto-apply-panel .boss-auto-tip { margin-top: 7px; color: #7a8794; font-size: 12px; line-height: 1.45; }
      #boss-auto-apply-panel .boss-auto-actions { display: flex; gap: 9px; }
      #boss-auto-apply-toggle, #boss-auto-apply-stop, #boss-auto-apply-scan, #boss-auto-apply-clear-history { border: 0; border-radius: 11px; padding: 10px 14px; color: #fff; cursor: pointer; font-weight: 800; transition: transform .12s, box-shadow .12s, background .12s, opacity .12s; }
      #boss-auto-apply-toggle { flex: 1; background: #00b38a; box-shadow: 0 5px 14px rgba(0,179,138,.22); }
      #boss-auto-apply-toggle.running { background: #94a3b8; box-shadow: none; }
      #boss-auto-apply-stop { background: #e5484d; box-shadow: 0 5px 14px rgba(229,72,77,.22); }
      #boss-auto-apply-scan { background: #3b82f6; box-shadow: 0 5px 14px rgba(59,130,246,.2); }
      #boss-auto-apply-clear-history { background: #64748b; box-shadow: 0 5px 14px rgba(100,116,139,.18); }
      #boss-auto-apply-toggle:hover:not(:disabled), #boss-auto-apply-stop:hover:not(:disabled), #boss-auto-apply-scan:hover:not(:disabled), #boss-auto-apply-clear-history:hover:not(:disabled), #boss-auto-apply-panel .boss-auto-collapse:hover { transform: translateY(-1px); }
      #boss-auto-apply-toggle:disabled, #boss-auto-apply-stop:disabled { background: #cbd5e1; box-shadow: none; cursor: not-allowed; opacity: .78; }
      #boss-auto-apply-log { height: 260px; overflow: auto; padding: 10px; border: 1px solid #edf2f7; border-radius: 11px; background: #fbfdff; }
      .boss-auto-apply-log-item { margin: 0 0 7px; line-height: 1.45; word-break: break-word; color: #405261; }
      .boss-auto-apply-log-item.success { color: #087f5b; }
      .boss-auto-apply-log-item.warn { color: #b7791f; }
      .boss-auto-apply-log-item.error { color: #c53030; }
      @media (max-width: 700px) { #boss-auto-apply-panel { left: 10px !important; right: 10px; top: 72px; width: auto; max-height: calc(100vh - 92px); } #boss-auto-apply-panel.is-collapsed { width: 218px; right: auto; } #boss-auto-apply-panel .boss-auto-switches { grid-template-columns: 1fr; } }
    `;
    document.documentElement.appendChild(style);

    const panel = document.createElement('section');
    panel.id = 'boss-auto-apply-panel';
    panel.innerHTML = `
      <div class="boss-auto-header">
        <div class="boss-auto-title">
          <span class="boss-auto-logo">投</span>
          <div>
            <h3>BOSS 自动投递助手</h3>
            <div class="boss-auto-subtitle">\u62d6\u52a8\u60ac\u6d6e \u00b7 \u5916\u5305\u62e6\u622a \u00b7 \u6d3b\u8dc3Boss\u8fc7\u6ee4</div>
          </div>
        </div>
        <div class="boss-auto-head-actions">
          <button id="boss-auto-apply-collapse" class="boss-auto-collapse" title="收起/展开">—</button>
        </div>
      </div>
      <div class="boss-auto-body">
        <div id="boss-auto-apply-status" class="boss-auto-status">已下滑 0 次｜捕获 0｜成功 0/30｜失败 0｜跳过 0</div>
        <div class="boss-auto-card">
          <div class="boss-auto-card-title">投递设置</div>
          <textarea id="boss-auto-apply-greeting" placeholder="投递成功后发送的招呼语模板。支持变量：{company}公司、{title}岗位、{salary}薪资、{area}地区"></textarea>
          <textarea id="boss-auto-apply-foreign-keywords" placeholder="外企关键词：开启只投外企后，命中这些词才投递。用逗号分隔，例如：外企,欧美,Global,APAC,世界500强"></textarea>
          <div class="boss-auto-inline-actions"><button id="boss-auto-apply-reset-foreign" class="boss-auto-link-button" type="button">恢复默认外企关键词</button></div>
          <textarea id="boss-auto-apply-outsource-keywords" placeholder="外包拦截名单：开启外包拦截后，命中公司名/岗位信息就跳过。用逗号分隔，例如：中软国际,软通动力,文思海辉"></textarea>
          <div class="boss-auto-inline-actions"><button id="boss-auto-apply-reset-outsource" class="boss-auto-link-button" type="button">恢复默认外包名单</button></div>
          <div class="boss-auto-controls">
            <div class="boss-auto-field"><label>最大投递数</label><input id="boss-auto-apply-max" type="number" min="1" max="200"></div>
            <div class="boss-auto-field"><label>间隔秒</label><input id="boss-auto-apply-interval" type="number" min="1" max="60"></div>
            <div class="boss-auto-field"><label>Boss活跃天数</label><input id="boss-auto-apply-active-days" type="number" min="0" max="365"></div>
          </div>
          <div class="boss-auto-switches">
            <label class="boss-auto-check boss-auto-switch"><input id="boss-auto-apply-auto-greeting" type="checkbox"><span class="boss-auto-switch-ui"></span><span>智能招呼语</span></label>
            <label class="boss-auto-check boss-auto-switch"><input id="boss-auto-apply-only-foreign" type="checkbox"><span class="boss-auto-switch-ui"></span><span>只投外企</span></label>
            <label class="boss-auto-check boss-auto-switch"><input id="boss-auto-apply-block-outsource" type="checkbox"><span class="boss-auto-switch-ui"></span><span>外包拦截</span></label>
            <label class="boss-auto-check boss-auto-switch"><input id="boss-auto-apply-only-active" type="checkbox"><span class="boss-auto-switch-ui"></span><span>过滤不活跃Boss</span></label>
            <label class="boss-auto-check boss-auto-switch"><input id="boss-auto-apply-skip-contacted" type="checkbox"><span class="boss-auto-switch-ui"></span><span>跳过历史沟通</span></label>
          </div>
          <div class="boss-auto-tip">\u5f00\u542f\u201c\u8fc7\u6ee4\u4e0d\u6d3b\u8dc3Boss\u201d\u540e\uff0c\u53ea\u6295\u9012\u6700\u8fd1\u6307\u5b9a\u5929\u6570\u5185\u6d3b\u8dc3\u7684 Boss\uff1b\u5f00\u542f\u201c\u8df3\u8fc7\u5386\u53f2\u6c9f\u901a\u201d\u540e\uff0c\u4f1a\u7528\u672c\u5730\u5386\u53f2\u548c\u9875\u9762\u804a\u5929\u72b6\u6001\u907f\u514d\u91cd\u590d\u6295\u9012\u3002</div>
        </div>
        <div class="boss-auto-card">
          <div class="boss-auto-actions">
            <button id="boss-auto-apply-toggle">\u5f00\u59cb\u6295\u9012</button>
            <button id="boss-auto-apply-stop" type="button">\u505c\u6b62</button>
            <button id="boss-auto-apply-scan">扫描当前页</button>
            <button id="boss-auto-apply-clear-history" type="button">清空历史</button>
          </div>
        </div>
        <div class="boss-auto-card">
          <div class="boss-auto-card-title">运行日志</div>
          <div id="boss-auto-apply-log"></div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    panel.querySelector('#boss-auto-apply-greeting').value = settings.greeting;
    panel.querySelector('#boss-auto-apply-foreign-keywords').value = formatKeywords(settings.foreignKeywords || defaultSettings.foreignKeywords);
    panel.querySelector('#boss-auto-apply-outsource-keywords').value = formatKeywords(settings.outsourceKeywords || defaultSettings.outsourceKeywords);
    panel.querySelector('#boss-auto-apply-max').value = settings.maxApply;
    panel.querySelector('#boss-auto-apply-interval').value = settings.intervalSeconds;
    panel.querySelector('#boss-auto-apply-active-days').value = settings.activeBossDays ?? defaultSettings.activeBossDays;
    panel.querySelector('#boss-auto-apply-auto-greeting').checked = settings.autoSendGreeting;
    panel.querySelector('#boss-auto-apply-only-foreign').checked = settings.onlyForeignCompany === true;
    panel.querySelector('#boss-auto-apply-block-outsource').checked = settings.blockOutsourceCompany === true;
    panel.querySelector('#boss-auto-apply-only-active').checked = settings.onlyActiveBoss === true;
    panel.querySelector('#boss-auto-apply-skip-contacted').checked = settings.skipPreviouslyContacted !== false;
    updateActiveDaysInputState();

    const collapseButton = panel.querySelector('#boss-auto-apply-collapse');
    const header = panel.querySelector('.boss-auto-header');

    const updateCollapseState = () => {
      panel.classList.toggle('is-collapsed', settings.panelCollapsed === true);
      collapseButton.textContent = settings.panelCollapsed ? '+' : '—';
      collapseButton.title = settings.panelCollapsed ? '展开' : '收起';
    };

    const clampPanelPosition = (persist = true) => {
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height, window.innerHeight - 16) - 8);
      const left = Math.min(Math.max(rect.left, 8), maxLeft);
      const top = Math.min(Math.max(rect.top, 8), maxTop);
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.right = 'auto';
      if (persist) {
        settings.panelLeft = Math.round(left);
        settings.panelTop = Math.round(top);
        saveSettings();
      }
    };

    const applySavedPosition = () => {
      const savedLeft = Number(settings.panelLeft);
      const savedTop = Number(settings.panelTop);
      const hasSavedPosition = settings.panelLeft != null
        && settings.panelTop != null
        && Number.isFinite(savedLeft)
        && Number.isFinite(savedTop);
      if (hasSavedPosition) {
        panel.style.left = `${savedLeft}px`;
        panel.style.top = `${savedTop}px`;
        panel.style.right = 'auto';
      } else {
        const rect = panel.getBoundingClientRect();
        panel.style.left = `${Math.max(8, window.innerWidth - rect.width - 22)}px`;
        panel.style.top = '72px';
        panel.style.right = 'auto';
      }
      clampPanelPosition(false);
    };

    const toggleCollapse = () => {
      settings.panelCollapsed = !settings.panelCollapsed;
      updateCollapseState();
      saveSettings();
      requestAnimationFrame(() => clampPanelPosition());
    };

    let dragState = null;
    const finishDrag = (event) => {
      if (!dragState) return;
      header.releasePointerCapture?.(event.pointerId);
      const moved = dragState.moved;
      dragState = null;
      panel.classList.remove('is-dragging');
      if (moved) clampPanelPosition();
    };

    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button,input,textarea,label,a')) return;
      const rect = panel.getBoundingClientRect();
      dragState = {
        pointerId: event.pointerId,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        moved: false,
      };
      panel.classList.add('is-dragging');
      header.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener('pointermove', (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      dragState.moved = true;
      const rect = panel.getBoundingClientRect();
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
      const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height, window.innerHeight - 16) - 8);
      const left = Math.min(Math.max(event.clientX - dragState.offsetX, 8), maxLeft);
      const top = Math.min(Math.max(event.clientY - dragState.offsetY, 8), maxTop);
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.right = 'auto';
    });
    header.addEventListener('pointerup', finishDrag);
    header.addEventListener('pointercancel', finishDrag);

    panel.querySelectorAll('textarea,input').forEach((input) => input.addEventListener('change', syncSettingsFromPanel));
    panel.querySelector('#boss-auto-apply-reset-foreign').addEventListener('click', () => {
      syncSettingsFromPanel();
      const foreignKeywords = panel.querySelector('#boss-auto-apply-foreign-keywords');
      foreignKeywords.value = formatKeywords(defaultSettings.foreignKeywords);
      settings.foreignKeywords = formatKeywords(defaultSettings.foreignKeywords);
      saveSettings();
      log('已恢复默认外企关键词。', 'success');
    });
    panel.querySelector('#boss-auto-apply-reset-outsource').addEventListener('click', () => {
      syncSettingsFromPanel();
      const outsourceKeywords = panel.querySelector('#boss-auto-apply-outsource-keywords');
      outsourceKeywords.value = formatKeywords(defaultSettings.outsourceKeywords);
      settings.outsourceKeywords = formatKeywords(defaultSettings.outsourceKeywords);
      saveSettings();
      log('已恢复默认外包拦截名单。', 'success');
    });
    collapseButton.addEventListener('click', toggleCollapse);
    header.addEventListener('dblclick', (event) => {
      if (event.target.closest('button,input,textarea,label,a')) return;
      toggleCollapse();
    });
    updateCollapseState();
    requestAnimationFrame(applySavedPosition);
    window.addEventListener('resize', () => clampPanelPosition(false));
    panel.querySelector('#boss-auto-apply-toggle').addEventListener('click', () => {
      if (state.running) return;
      syncSettingsFromPanel();
      run();
    });
    panel.querySelector('#boss-auto-apply-stop').addEventListener('click', () => {
      stop('\u7528\u6237\u624b\u52a8\u505c\u6b62');
    });
    panel.querySelector('#boss-auto-apply-scan').addEventListener('click', () => {
      syncSettingsFromPanel();
      const before = state.capturedJobs.size;
      scanDomJobs();
      log(`扫描完成，新增 ${state.capturedJobs.size - before} 个职位，当前共 ${state.capturedJobs.size} 个`, 'info');
    });
    panel.querySelector('#boss-auto-apply-clear-history').addEventListener('click', () => {
      clearContactHistory();
      log('已清空本地历史沟通记录。', 'success');
    });

    updateStatus();
    log('脚本已加载。面板可拖动/收起；请先在 BOSS 页面筛选岗位，再开始投递。', 'info');
  };

  patchFetch();
  patchXhr();

  const ready = () => {
    mountPanel();
    setTimeout(scanDomJobs, 1200);
    setInterval(() => {
      if (!state.running) scanDomJobs();
    }, 5000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
