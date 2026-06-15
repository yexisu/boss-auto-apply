// ==UserScript==
// @name         BOSS自动投递助手（无AI）
// @namespace    local.boss.auto.apply
// @version      1.2.1
// @description  BOSS直聘自动投递：接口投递、自动下滑加载、屏蔽词、过滤不活跃Boss；不含AI、不连接第三方服务。
// @author       local
// @match        https://www.zhipin.com/web/geek/*
// @match        https://www.zhipin.com/overseas/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const STORAGE_KEY = 'boss_auto_apply_settings_v1';
  const END_REASONS = /上限|频繁|验证|安全|今日沟通人数|请稍后|风控|异常流量|登录/;
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
    stopReason: '',
  };

  const defaultSettings = {
    greeting: '您好，我对这个岗位很感兴趣，方便的话可以进一步沟通一下。',
    maxApply: 30,
    intervalSeconds: 4,
    autoSendGreeting: true,
    blockKeywords: '',
    onlyForeignCompany: false,
    foreignKeywords: '外企\n欧美\n美国\n欧洲\n德国\n法国\n英国\n瑞士\n瑞典\n荷兰\n丹麦\n芬兰\n挪威\n日本\n韩国\n新加坡\n跨国公司\n世界500强\nFortune\nNASDAQ\nNYSE\n纳斯达克\n纽交所\n外资\n合资\n独资\n代表处\n办事处\n中国区\n亚太\nAPAC\nMNC\nGlobal\nInternational',
    onlyActiveBoss: false,
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

  const blockHit = (job) => {
    const keywords = parseKeywords(settings.blockKeywords);
    if (!keywords.length) return null;
    const rawText = (() => {
      try {
        return JSON.stringify(job.raw || {});
      } catch (_) {
        return '';
      }
    })();
    const target = [job.company, job.title, job.salary, job.area, rawText].filter(Boolean).join(' ').toLowerCase();
    return keywords.find((keyword) => target.includes(keyword.toLowerCase())) || null;
  };

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

  const getCookie = (name) => {
    const escapedName = name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&');
    const match = document.cookie.match(new RegExp(`(?:^|; )${escapedName}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  };

  const safeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const ACTIVE_FIELD_PATTERN = /active|online|lastlogin|lastactive|bossactive|bossonline|活跃|在线/i;
  const ACTIVE_TEXT_PATTERN = /(刚刚在线|当前在线|在线|刚刚活跃|今日活跃|今天活跃|近期活跃|最近活跃|\d+\s*(?:秒|分钟|小时|天|日|周|月|年)(?:前|内)?(?:活跃|在线)?|[一二三四五六七八九十两]+\s*(?:秒|分钟|小时|天|日|周|月|年)(?:前|内)?(?:活跃|在线)?|不活跃|很久未活跃|本周活跃|本月活跃)/;

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
    const encryptBossId = raw.encryptBossId || raw.encryptBossID || raw.bossId || raw.encryptUid || raw.encryptUserId || '';
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
    const contacted = raw.contact === true || friendStatus === 1 || /继续沟通|已沟通|沟通过/.test(safeText(raw.statusText || raw.actionText || raw.btnText || ''));
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
      activeText,
      source,
      raw,
    };
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
        if (job && !state.capturedJobs.has(job.key)) {
          state.capturedJobs.set(job.key, job);
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
      if (job && !state.capturedJobs.has(job.key)) {
        state.capturedJobs.set(job.key, job);
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

  const isActiveText = (text) => {
    const normalized = safeText(text);
    if (!normalized) return null;

    if (/不活跃|很久|前天|昨日|昨天|本周|本月|周前|月前|年前|天前|日前/.test(normalized)) return false;
    if (/([4-9]|[1-9]\d+)\s*[天日]内/.test(normalized)) return false;
    if (/刚刚|在线|当前|今日|今天|秒前|分钟前|小时前|[1-3]\s*[天日]内|[一二三]\s*[天日]内|近期活跃|最近活跃/.test(normalized)) return true;
    if (/活跃/.test(normalized) && !/周|月|年|天前|日前|昨日|昨天|前天/.test(normalized)) return true;
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

  const getSocketConnect = () => {
    try {
      return window.GeekChatCore?.getInstance?.()?.socketConnect;
    } catch (_) {
      return null;
    }
  };

  const sendGreeting = async (job) => {
    const greeting = safeText(settings.greeting);
    if (!settings.autoSendGreeting || !greeting) return { skipped: true, reason: '未启用招呼语' };

    const bossData = await fetchBossData(job);
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
      return { sent: true, mode: 'sendMessage' };
    }
    if (socketConnect?.sendTextMessage) {
      socketConnect.sendTextMessage(user, greeting);
      return { sent: true, mode: 'sendTextMessage' };
    }

    throw new Error('页面聊天SDK不可用，无法发送招呼语');
  };

  const scrollForMoreJobs = async (shouldContinue = () => state.running) => {
    const beforeSize = state.capturedJobs.size;
    const beforeY = window.scrollY;

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
      if (Math.abs(window.scrollY - beforeY) < 10 && index > 1) break;
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
    state.runId += 1;
    const runId = state.runId;
    const isCurrentRun = () => state.running && state.runId === runId;
    state.currentRunStartedAt = Date.now();
    state.stopReason = '';
    updateStatus();

    log('开始自动投递，已重置本轮扫描状态。请保持当前 BOSS 页面打开。', 'info');
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
        if (state.emptyScrollBatches >= 3) {
          stop('连续下滑没有发现新的待投岗位，投递结束');
          break;
        }
        log('当前可见区域没有待投岗位，继续向下加载。', 'info');
        await sleep(600);
        continue;
      }

      state.processedKeys.add(job.key);

      const blockedKeyword = blockHit(job);
      if (blockedKeyword) {
        state.skipped += 1;
        log(`跳过屏蔽词【${blockedKeyword}】：${formatJob(job)}`, 'warn');
        updateStatus();
        await scrollForMoreJobs(isCurrentRun);
        continue;
      }

      const foreignKeyword = foreignCompanyHit(job);
      if (settings.onlyForeignCompany && !foreignKeyword) {
        state.skipped += 1;
        log(`跳过非外企/未命中外企关键词：${formatJob(job)}`, 'warn');
        updateStatus();
        await scrollForMoreJobs(isCurrentRun);
        continue;
      }
      if (foreignKeyword) {
        log(`命中外企关键词【${foreignKeyword}】：${formatJob(job)}`, 'info');
      }

      if (job.contacted) {
        state.skipped += 1;
        log(`跳过已打招呼/已沟通，继续向下查找：${formatJob(job)}`, 'warn');
        updateStatus();
        await scrollForMoreJobs(isCurrentRun);
        continue;
      }

      if (settings.onlyActiveBoss) {
        const activeResult = await isActiveBoss(job);
        if (!isCurrentRun()) break;
        if (!activeResult.active) {
          state.skipped += 1;
          log(`跳过不活跃Boss【${activeResult.text}】：${formatJob(job)}`, 'warn');
          updateStatus();
          await scrollForMoreJobs(isCurrentRun);
          continue;
        }
        log(`Boss近期活跃【${activeResult.text}】：${formatJob(job)}`, 'info');
      }

      try {
        log(`投递中：${formatJob(job)}`, 'info');
        await applyJob(job);
        if (!isCurrentRun()) break;
        state.success += 1;
        log(`投递成功：${formatJob(job)}`, 'success');

        try {
          const result = await sendGreeting(job);
          if (!isCurrentRun()) break;
          if (result?.sent) log(`招呼语已发送：${formatJob(job)}`, 'success');
        } catch (error) {
          log(`招呼语发送失败：${error.message}`, 'warn');
        }
      } catch (error) {
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
    if (status) {
      status.textContent = `已下滑 ${state.scrollCount} 次｜捕获 ${state.capturedJobs.size}｜成功 ${state.success}/${settings.maxApply}｜失败 ${state.failed}｜跳过 ${state.skipped}`;
    }
    if (toggle) {
      toggle.textContent = state.running ? '停止投递' : '开始投递';
      toggle.classList.toggle('running', state.running);
    }
  };

  const syncSettingsFromPanel = () => {
    const greeting = document.querySelector('#boss-auto-apply-greeting');
    const maxApply = document.querySelector('#boss-auto-apply-max');
    const interval = document.querySelector('#boss-auto-apply-interval');
    const autoGreeting = document.querySelector('#boss-auto-apply-auto-greeting');
    const blockKeywords = document.querySelector('#boss-auto-apply-block-keywords');
    const onlyForeignCompany = document.querySelector('#boss-auto-apply-only-foreign');
    const foreignKeywords = document.querySelector('#boss-auto-apply-foreign-keywords');
    const onlyActiveBoss = document.querySelector('#boss-auto-apply-only-active');

    settings.greeting = greeting?.value || defaultSettings.greeting;
    settings.maxApply = Math.max(1, Math.min(200, Number(maxApply?.value) || defaultSettings.maxApply));
    settings.intervalSeconds = Math.max(1, Math.min(60, Number(interval?.value) || defaultSettings.intervalSeconds));
    settings.autoSendGreeting = autoGreeting?.checked !== false;
    settings.blockKeywords = blockKeywords?.value || '';
    settings.onlyForeignCompany = onlyForeignCompany?.checked === true;
    settings.foreignKeywords = foreignKeywords?.value || defaultSettings.foreignKeywords;
    settings.onlyActiveBoss = onlyActiveBoss?.checked === true;
    saveSettings();
    updateStatus();
  };

  const mountPanel = () => {
    if (document.querySelector('#boss-auto-apply-panel')) return;

    const style = document.createElement('style');
    style.textContent = `
      #boss-auto-apply-panel { position: fixed; right: 22px; top: 88px; z-index: 2147483647; width: 372px; max-height: min(78vh, 760px); display: flex; flex-direction: column; border-radius: 20px; background: rgba(255,255,255,.97); backdrop-filter: blur(14px); border: 1px solid rgba(0,179,138,.18); box-shadow: 0 18px 48px rgba(15,23,42,.18); color: #1f2933; font-size: 14px; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,"Microsoft YaHei",sans-serif; overflow: hidden; transition: width .16s ease, box-shadow .16s ease, transform .16s ease; }
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
      #boss-auto-apply-panel .boss-auto-body { padding: 12px; overflow: auto; }
      #boss-auto-apply-panel .boss-auto-status { color: #0f766e; background: #e8f8f3; border: 1px solid #c6eee2; border-radius: 999px; padding: 7px 10px; margin-bottom: 12px; font-size: 12px; line-height: 1.35; }
      #boss-auto-apply-panel .boss-auto-card { background: #fff; border: 1px solid #edf2f7; border-radius: 14px; padding: 11px; margin-bottom: 10px; }
      #boss-auto-apply-panel .boss-auto-card-title { margin: 0 0 9px; font-weight: 800; color: #26323f; }
      #boss-auto-apply-panel textarea { width: 100%; min-height: 72px; resize: vertical; padding: 9px 10px; border: 1px solid #d9e2ec; border-radius: 10px; outline: none; line-height: 1.5; background: #fff; color: #1f2933; transition: border-color .15s, box-shadow .15s; }
      #boss-auto-apply-panel textarea + textarea { margin-top: 8px; }
      #boss-auto-apply-panel textarea:focus, #boss-auto-apply-panel input:focus { border-color: #00b38a; box-shadow: 0 0 0 3px rgba(0,179,138,.12); }
      #boss-auto-apply-panel .boss-auto-inline-actions { display: flex; justify-content: flex-end; margin-top: 7px; }
      #boss-auto-apply-panel .boss-auto-link-button { border: 0; border-radius: 999px; padding: 6px 10px; background: #e8f8f3; color: #087f5b; cursor: pointer; font-size: 12px; font-weight: 800; }
      #boss-auto-apply-panel .boss-auto-link-button:hover { background: #d7f3eb; }
      #boss-auto-apply-panel .boss-auto-controls { display: grid; grid-template-columns: repeat(3, 1fr); gap: 9px; margin-top: 10px; }
      #boss-auto-apply-panel .boss-auto-controls-two { grid-template-columns: repeat(2, 1fr); }
      #boss-auto-apply-panel .boss-auto-field label { display: block; margin-bottom: 5px; color: #66788a; font-size: 12px; }
      #boss-auto-apply-panel input[type="number"] { width: 100%; padding: 8px 9px; border: 1px solid #d9e2ec; border-radius: 10px; outline: none; background: #fff; }
      #boss-auto-apply-panel .boss-auto-switches { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 10px; }
      #boss-auto-apply-panel .boss-auto-check { min-height: 38px; padding: 0 10px; border: 1px solid #d9e2ec; border-radius: 12px; background: #fbfdff; color: #405261; }
      #boss-auto-apply-panel .boss-auto-switch { position: relative; display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
      #boss-auto-apply-panel .boss-auto-switch input { position: absolute; opacity: 0; pointer-events: none; }
      #boss-auto-apply-panel .boss-auto-switch-ui { position: relative; flex: 0 0 auto; width: 36px; height: 20px; border-radius: 999px; background: #cbd5e1; transition: background .15s; }
      #boss-auto-apply-panel .boss-auto-switch-ui::after { content: ""; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(15,23,42,.22); transition: transform .15s; }
      #boss-auto-apply-panel .boss-auto-switch input:checked + .boss-auto-switch-ui { background: #00b38a; }
      #boss-auto-apply-panel .boss-auto-switch input:checked + .boss-auto-switch-ui::after { transform: translateX(16px); }
      #boss-auto-apply-panel .boss-auto-tip { margin-top: 7px; color: #7a8794; font-size: 12px; line-height: 1.45; }
      #boss-auto-apply-panel .boss-auto-actions { display: flex; gap: 9px; }
      #boss-auto-apply-toggle, #boss-auto-apply-scan { border: 0; border-radius: 11px; padding: 10px 14px; color: #fff; cursor: pointer; font-weight: 800; transition: transform .12s, box-shadow .12s, background .12s; }
      #boss-auto-apply-toggle { flex: 1; background: #00b38a; box-shadow: 0 5px 14px rgba(0,179,138,.22); }
      #boss-auto-apply-toggle.running { background: #e5484d; box-shadow: 0 5px 14px rgba(229,72,77,.22); }
      #boss-auto-apply-scan { background: #3b82f6; box-shadow: 0 5px 14px rgba(59,130,246,.2); }
      #boss-auto-apply-toggle:hover, #boss-auto-apply-scan:hover, #boss-auto-apply-panel .boss-auto-collapse:hover { transform: translateY(-1px); }
      #boss-auto-apply-log { height: 190px; overflow: auto; padding: 9px; border: 1px solid #edf2f7; border-radius: 11px; background: #fbfdff; }
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
            <div class="boss-auto-subtitle">拖动悬浮 · 屏蔽词 · 活跃Boss过滤</div>
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
          <textarea id="boss-auto-apply-greeting" placeholder="投递成功后发送的固定招呼语"></textarea>
          <textarea id="boss-auto-apply-block-keywords" placeholder="屏蔽词：命中公司名/职位名/地区等就跳过，支持换行、逗号、空格分隔。例如：外包 培训 销售 某某公司"></textarea>
          <textarea id="boss-auto-apply-foreign-keywords" placeholder="外企关键词：开启只投外企后，命中这些词才投递。可按公司标签补充，例如：外企 欧美 Global APAC 世界500强"></textarea>
          <div class="boss-auto-inline-actions"><button id="boss-auto-apply-reset-foreign" class="boss-auto-link-button" type="button">恢复默认外企关键词</button></div>
          <div class="boss-auto-controls boss-auto-controls-two">
            <div class="boss-auto-field"><label>最大投递数</label><input id="boss-auto-apply-max" type="number" min="1" max="200"></div>
            <div class="boss-auto-field"><label>间隔秒</label><input id="boss-auto-apply-interval" type="number" min="1" max="60"></div>
          </div>
          <div class="boss-auto-switches">
            <label class="boss-auto-check boss-auto-switch"><input id="boss-auto-apply-auto-greeting" type="checkbox"><span class="boss-auto-switch-ui"></span><span>发送招呼语</span></label>
            <label class="boss-auto-check boss-auto-switch"><input id="boss-auto-apply-only-foreign" type="checkbox"><span class="boss-auto-switch-ui"></span><span>只投外企</span></label>
            <label class="boss-auto-check boss-auto-switch"><input id="boss-auto-apply-only-active" type="checkbox"><span class="boss-auto-switch-ui"></span><span>过滤不活跃Boss</span></label>
          </div>
          <div class="boss-auto-tip">开启“只投外企”后，会用外企关键词匹配公司标签/职位卡片；开启“过滤不活跃Boss”后，活跃度未知会跳过。</div>
        </div>
        <div class="boss-auto-card">
          <div class="boss-auto-actions">
            <button id="boss-auto-apply-toggle">开始投递</button>
            <button id="boss-auto-apply-scan">扫描当前页</button>
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
    panel.querySelector('#boss-auto-apply-block-keywords').value = settings.blockKeywords || '';
    panel.querySelector('#boss-auto-apply-foreign-keywords').value = settings.foreignKeywords || defaultSettings.foreignKeywords;
    panel.querySelector('#boss-auto-apply-max').value = settings.maxApply;
    panel.querySelector('#boss-auto-apply-interval').value = settings.intervalSeconds;
    panel.querySelector('#boss-auto-apply-auto-greeting').checked = settings.autoSendGreeting;
    panel.querySelector('#boss-auto-apply-only-foreign').checked = settings.onlyForeignCompany === true;
    panel.querySelector('#boss-auto-apply-only-active').checked = settings.onlyActiveBoss === true;

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
      if (Number.isFinite(savedLeft) && Number.isFinite(savedTop)) {
        panel.style.left = `${savedLeft}px`;
        panel.style.top = `${savedTop}px`;
        panel.style.right = 'auto';
      } else {
        const rect = panel.getBoundingClientRect();
        panel.style.left = `${Math.max(8, window.innerWidth - rect.width - 22)}px`;
        panel.style.top = '88px';
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
      const foreignKeywords = panel.querySelector('#boss-auto-apply-foreign-keywords');
      foreignKeywords.value = defaultSettings.foreignKeywords;
      settings.foreignKeywords = defaultSettings.foreignKeywords;
      saveSettings();
      log('已恢复默认外企关键词。', 'success');
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
      syncSettingsFromPanel();
      if (state.running) stop('用户手动停止'); else run();
    });
    panel.querySelector('#boss-auto-apply-scan').addEventListener('click', () => {
      syncSettingsFromPanel();
      const before = state.capturedJobs.size;
      scanDomJobs();
      log(`扫描完成，新增 ${state.capturedJobs.size - before} 个职位，当前共 ${state.capturedJobs.size} 个`, 'info');
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
