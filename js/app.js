/* =========================================================================
 * 商品运营AI看板 - 主逻辑（全数据驱动）
 * 每个业绩数字对应 目标金额 + 截止日期实际额 -> 目标进度/时间进度/超前滞后
 * 维度：站点(4) / 类目 / 商品结构层 / 单品(可下钻)
 * 复盘：OGSM 配置驱动；运营/投放：钉钉抓取(示例) + 筛选
 * ========================================================================= */
'use strict';

let appData = {};
let A = null;                 // 当前月 actuals
const state = { page: 'site', sub: 'all', month: '7月', cutoff: '2026-07-14',
                timeProgress: 45.2, shopLayer: 'all', focusCycle: {start: '2026-07-01', end: '2026-07-14'} };
const SITES = ['AC美', 'BV美', 'UK英', 'EU欧'];
const CATS = ['飞机杯', '增大器', '龟头训练器'];
const LAYERS = ['超爆', '爆款', '头部', '腰部', '尾部'];
const CHANNELS = ['亚马逊', '独立站', 'eBay', '速卖通'];
let exchangeRates = { 'AC美': 6.7167, 'BV美': 6.7167, 'UK英': 9.0339, 'EU欧': 7.8122 };
const siteColor = { 'AC美': '#22d3ee', 'BV美': '#60a5fa', 'UK英': '#a78bfa', 'EU欧': '#34d399' };
const layerColor = { '超爆': '#f59e0b', '爆款': '#fb7185', '头部': '#60a5fa', '腰部': '#34d399', '尾部': '#94a3b8' };
let chartRegistry = [];
function safeInit(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    const inst = echarts.getInstanceByDom(el);
    if (inst) inst.dispose();
    const c = echarts.init(el); chartRegistry.push(c); return c;
}

/* ----------------- 通用工具 ----------------- */
const money = n => '¥' + Math.round(n || 0).toLocaleString();
const fmtW = n => '¥' + (n / 10000).toFixed(1) + '万';
const pct = n => (n || 0).toFixed(1) + '%';
const num = n => (n || 0).toLocaleString();
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
function cls(progress, tp) {
    const expect = (tp == null ? state.timeProgress : tp);
    if (progress >= expect) return 'pos';
    if (progress >= expect - 10) return 'warn';
    return 'neg';
}
function gapTag(gap) {
    const v = Math.round(gap || 0);
    if (v >= 0) return `<span class="tag tag-green">超前 ${fmtW(v)}</span>`;
    return `<span class="tag tag-red">滞后 ${fmtW(Math.abs(v))}</span>`;
}
function card(title, value, sub, tone) {
    return `<div class="stat-card"><div class="stat-card-label">${title}</div>
        <div class="stat-card-value ${tone || ''}">${value}</div>
        <div class="stat-card-sub">${sub || ''}</div></div>`;
}

/* 目标对照总览 Hero —— 对标 OGSM 周复盘「目标」写法：
   目标额 / 完成额 / 时间进度 / 目标进度(完成进度) / 超前滞后 / 预估全月完成率+缺口 + 进度条时间刻度
   o: {scope:'销售额'|'单量', target, actual, orders?, aov?, mom?, momLabel?, title, meta?} */
function targetHeroHTML(o) {
    const scope = o.scope || '销售额';
    const target = o.target || 0, actual = o.actual || 0;
    const tp = (o.timeProgress != null) ? o.timeProgress : state.timeProgress;
    const fmt = scope === '单量' ? (v => num(v)) : (v => fmtW(v));
    const rate = target ? actual / target * 100 : 0;
    const estRate = tp ? rate * 100 / tp : 0;            // 预估全月完成率(%)
    const estFull = tp ? actual * 100 / tp : actual;     // 预估全月值
    const gap = actual - target * tp / 100;              // 实际 − 目标×时间进度（超前正/滞后负）
    const progressGap = rate - tp;
    const status = cls(rate, tp);                        // pos / warn / neg
    const hi = rate > 100 ? 100 : rate;
    const momTxt = (o.mom != null) ? `${pct(o.mom)}${o.mom >= 0 ? ' ↑' : ' ↓'}` : '';
    return `<div class="target-hero">
      <div class="th-head">
        <span class="th-title">${esc(o.title || '目标对照总览')}</span>
        <span class="th-meta">数据周期 ${esc(state.month)} · 截止 <b>${esc((o.cutoff || state.cutoff).slice(5))}</b> · 时间进度 <b>${pct(tp)}</b>${o.meta ? ' · ' + o.meta : ''}</span>
      </div>
      <div class="th-cards">
        <div class="th-card k-target">
          <div class="th-label">${scope === '单量' ? '目标单量' : '目标销售额'}</div>
          <div class="th-num">${fmt(target)}</div>
          <div class="th-sub">本月目标</div>
        </div>
        <div class="th-card k-done">
          <div class="th-label">${scope === '单量' ? '完成单量' : '完成销售额'}</div>
          <div class="th-num">${fmt(actual)}</div>
          <div class="th-sub">${o.orders != null ? num(o.orders) + ' 单 · ' : ''}${scope === '单量' ? '实际单量' : '客单价 ' + (o.aov != null ? money(o.aov) : '—')}</div>
        </div>
        <div class="th-card k-rate">
          <div class="th-label">${scope === '单量' ? '单量完成进度' : '销售进度（目标进度）'}</div>
          <div class="th-num">${pct(rate)}</div>
          <div class="th-sub">${progressGap >= 0 ? '🟢 超前 ' : '🔴 滞后 '}${Math.abs(progressGap).toFixed(1)}%</div>
        </div>
        <div class="th-card k-est">
          <div class="th-label">预估全月完成率</div>
          <div class="th-num">${pct(estRate)}</div>
          <div class="th-sub">预估全月 ${fmt(estFull)} · ${gap >= 0 ? '盈余 ' : '缺口 '}${fmt(Math.abs(gap))}</div>
        </div>
      </div>
      <div class="th-progress-wrap">
        <div class="th-progress">
          <div class="th-progress-fill ${status}" style="width:${hi}%"></div>
          <div class="th-time-marker" style="left:${Math.min(tp, 100)}%"></div>
        </div>
        <div class="th-legend">
          <span>目标进度（完成率）：<b>${pct(rate)}</b></span>
          <span>时间进度：<b>${pct(tp)}</b></span>
          <span>超前/滞后：<b class="${status === 'pos' ? 'tag-green' : status === 'neg' ? 'tag-red' : 'tag-yellow'}">${gap >= 0 ? '+' : '-'}${fmt(Math.abs(gap))}</b></span>
          ${o.mom != null ? `<span>${esc(o.momLabel || '环比')}：<b>${momTxt}</b></span>` : ''}
        </div>
      </div>
    </div>`;
}

/* ----------------- 加载 ----------------- */
document.addEventListener('DOMContentLoaded', () => { loadData(); initNavigation(); });

async function loadData() {
    try {
        const res = await fetch('js/data/data.json');
        appData = await res.json();
    } catch (e) { alert('数据加载失败：' + e.message); return; }
    A = appData.actuals[state.month] || appData.actuals[Object.keys(appData.actuals).pop()];
    state.month = A ? Object.keys(appData.actuals).find(k => appData.actuals[k] === A) : state.month;
    const mm = appData.month_meta || {};
    state.cutoff = (A && A.cutoff) || mm.cutoff || '2026-07-14';
    state.timeProgress = (A && A.time_progress) || mm.time_progress || 45.2;
    // 策略归一化
    appData.strategies = (appData.strategies || []).map(s => ({
        name: s.name || '', stage: s.stage || '', type: s.type || '',
        effect: s.evaluation || '待验证',
        score: s.priority === 'P0-必做' ? 90 : s.priority === 'P1-建议' ? 75 : 60,
        keyPoints: (s.actions || '').split(/[;；]/).map(k => k.trim()).filter(Boolean),
        why: s.reason || '策略有效性待验证', ogsm: s.ogsm || s.name || '',
        shop: s.shop || '', category: s.category || '', priority: s.priority || 'P2-可做'
    }));
    const added = JSON.parse(localStorage.getItem('addedStrategies') || '[]');
    if (added.length) appData.strategies = added.concat(appData.strategies);
    if (!appData.ogsm_config || !appData.ogsm_config.sections || !appData.ogsm_config.sections.length)
        appData.ogsm_config = defaultOgsmConfig();
    else normalizeOgsm(appData.ogsm_config);
    setupGlobalMonth();
    initFilters();
    seedSampleReviews();
    seedSampleFocus();
    switchPage('site', 'all');
}
function seedSampleReviews() {
    const cfg = appData.ogsm_config; if (!cfg || !cfg.sections) return;
    const weeks = ['第1周', '第2周', '第3周', '第4周'];
    const tp = state.timeProgress, prog = A.total.target_progress, gap = A.total.gap;
    const pc = c => fmtW(A.by_category[c].sales), pp = c => pct(A.by_category[c].target_progress), pm = c => pct(A.mom.by_category[c]);
    const sampleBySection = [
        { D: `本月截至${state.cutoff.slice(5)}完成销售额${fmtW(A.total.sales)}，目标进度${pct(prog)}%（时间进度${pct(tp)}%），${gap >= 0 ? '整体超前' : '整体滞后'}${fmtW(Math.abs(gap))}。分店铺中BV美、EU欧超前，AC美、UK英滞后约10万需重点追赶。`,
          check: `落后主要来自AC美/UK英站点（均滞后约10万），渠道端独立站转化偏弱；类目端增大器进度仅${pp('增大器')}，需加大投放与活动力度，拉动爆款/超爆层单品起量。` },
        { D: `飞机杯类目实际${pc('飞机杯')}，进度${pp('飞机杯')}，环比${pm('飞机杯')}%；增大器进度${pp('增大器')}%；龟头训练器基数小但环比${pm('龟头训练器')}%。`,
          check: `增大器进度落后于时间进度，主因腰部品转化不足；建议对腰部TOP20单品做详情页信任背书+评价维护，提升转化3-5pct。` },
        { D: `超爆层单量进度${pct(A.by_layer['超爆'].target_progress)}%、爆款层${pct(A.by_layer['爆款'].target_progress)}%、头部层${pct(A.by_layer['头部'].target_progress)}%；整体结构健康，超爆/爆款贡献主要销售额。`,
          check: `腰部层转化率偏低（约${pct(A.by_layer['腰部'].conv * 100)}），为结构短板；建议将腰部中自然流量上涨的苗头品纳入重点孵化，复制爆款打法。` },
        { D: `运营动作覆盖广告投放/活动报名/Listing优化等，投放端平均ROI约1.9；独立站与eBay渠道ROI偏低需优化素材与出价。`,
          check: `投放动作中'活动报名'类有效率高，'站外引流'待观察；建议下月预算向高ROI的类目与站点倾斜，收缩低效渠道。` }
    ];
    weeks.forEach(wk => {
        const key = 'ogsm_' + state.month + '_' + wk;
        if (localStorage.getItem(key)) return;
        const out = {};
        cfg.sections.forEach((sec, i) => sec.metrics.forEach((m, j) => {
            const sample = sampleBySection[i] || { D: '本周按目标正常推进，数据详见看板各板块。', check: '暂无显著偏差，持续监控分店铺/类目/分层进度。' };
            out[i + '_' + j] = { D: sample.D, check: sample.check };
        }));
        try { localStorage.setItem(key, JSON.stringify(out)); } catch (e) {}
    });
}
function seedSampleFocus() {
    if (localStorage.getItem('focusConfig')) return;
    const top = [...(appData.sku_master || [])].sort((a, b) => b.actual_orders - a.actual_orders).slice(0, 6)
        .map(r => ({ code: r.ns_code, site: r.site }));
    try { localStorage.setItem('focusConfig', JSON.stringify(top)); } catch (e) {}
}

function setupGlobalMonth() {
    const sel = document.getElementById('global-month');
    const months = Object.keys(appData.actuals || {}).sort((a, b) => parseInt(a) - parseInt(b));
    if (!months.includes(state.month) && months.length) { state.month = months[months.length - 1]; A = appData.actuals[state.month]; state.cutoff = A.cutoff; state.timeProgress = A.time_progress; }
    sel.innerHTML = months.map(m => `<option value="${m}" ${m === state.month ? 'selected' : ''}>${m}月</option>`).join('');
    sel.onchange = () => { state.month = sel.value; A = appData.actuals[state.month]; state.cutoff = A.cutoff; state.timeProgress = A.time_progress; rerender(); };
    const md = document.getElementById('monthly-month');
    if (md) md.innerHTML = months.map(m => `<option value="${m}" ${m === state.month ? 'selected' : ''}>${m}月</option>`).join('');
    document.getElementById('nav-date').textContent = '2026年' + state.month;
    document.getElementById('nav-cutoff').textContent = '截止 ' + state.cutoff.slice(5);
}
function rerender() {
    document.getElementById('nav-date').textContent = '2026年' + state.month;
    document.getElementById('nav-cutoff').textContent = '截止 ' + state.cutoff.slice(5);
    switchPage(state.page, state.sub);
}

/* ----------------- 导航 ----------------- */
function initNavigation() {
    document.querySelectorAll('.navbar-main-item').forEach(el => {
        el.onclick = () => {
            document.querySelectorAll('.navbar-main-item').forEach(x => x.classList.remove('active'));
            el.classList.add('active');
            const p = el.dataset.page;
            const first = document.querySelector(`.sidebar-nav-item[data-page="${p}"]`);
            switchPage(p, first ? (first.dataset.sub || 'all') : 'all');
        };
    });
    document.querySelectorAll('.sidebar-nav-item').forEach(el => {
        el.onclick = () => switchPage(el.dataset.page, el.dataset.sub || 'all');
    });
}
function switchPage(page, sub) {
    state.page = page; state.sub = sub; state.shopLayer = 'all';
    document.querySelectorAll('.sidebar-nav-item').forEach(x => x.classList.toggle('active', x.dataset.page === page && x.dataset.sub === (sub || 'all')));
    const map = { site: { all: 'page-site-all', _: 'page-site-detail' }, category: { all: 'page-category-all', _: 'page-category-detail' },
        product: { all: 'page-product-all', focus: 'page-product-focus', _: 'page-product-layer' },
        operations: { ops: 'page-operations-ops', ads: 'page-operations-ads' },
        review: { ogsms: 'page-review-ogsms', monthly: 'page-review-monthly' },
        strategy: { gen: 'page-strategy-gen', lib: 'page-strategy-lib' } };
    const sec = map[page];
    const id = sec[sub] || sec._;
    document.querySelectorAll('.page-section').forEach(s => s.style.display = 'none');
    const node = document.getElementById(id); if (node) node.style.display = 'block';
    if (page === 'site' && sub === 'all') renderSiteAll();
    else if (page === 'site') renderSiteDetail(sub);
    else if (page === 'category' && sub === 'all') renderCategoryAll();
    else if (page === 'category') renderCategoryDetail(sub);
    else if (page === 'product' && sub === 'all') renderProductAll();
    else if (page === 'product' && sub === 'focus') renderProductFocus();
    else if (page === 'product') renderProductLayer(sub);
    else if (page === 'operations' && sub === 'ops') renderOps();
    else if (page === 'operations' && sub === 'ads') renderAds();
    else if (page === 'review' && sub === 'ogsms') renderWeeklyReview();
    else if (page === 'review' && sub === 'monthly') generateMonthlyReview();
    else if (page === 'strategy' && sub === 'gen') generateStrategy();
    else if (page === 'strategy' && sub === 'lib') renderStrategyLib();
}

/* ===================================================================
 * 站点 - 全部汇总 HERO
 * =================================================================== */
function renderSiteAll() {
    const t = A.total, tgt = t.target_sales || 0;
    document.getElementById('site-summary-cards').innerHTML = targetHeroHTML({
        scope: '销售额', target: tgt, actual: t.sales, orders: t.orders, aov: t.aov,
        mom: A.mom.total, momLabel: '全站环比', title: '全部站点 · 目标对照总览',
        meta: `${SITES.length} 店铺合并`
    });
    // 排行
    const rank = safeInit('site-rank-chart');
    rank.setOption({ tooltip: { trigger: 'axis' }, grid: { left: 60, right: 20, top: 20, bottom: 30 },
        xAxis: { type: 'category', data: SITES, axisLabel: { color: '#94a3b8' } },
        yAxis: { type: 'value', axisLabel: { color: '#94a3b8', formatter: v => (v / 10000) + '万' } },
        series: [{ type: 'bar', data: SITES.map(s => A.by_site[s].sales), itemStyle: { color: p => siteColor[SITES[p.dataIndex]], borderRadius: [6, 6, 0, 0] } }] });
    // 趋势(目标 vs 实际按节奏)
    const months = Object.keys(appData.actuals).sort((a, b) => parseInt(a) - parseInt(b));
    const trend = safeInit('site-trend-chart');
    trend.setOption({ tooltip: { trigger: 'axis' }, legend: { data: ['目标', '实际(全月节奏)'], textStyle: { color: '#94a3b8' } },
        grid: { left: 60, right: 20, top: 30, bottom: 30 },
        xAxis: { type: 'category', data: months.map(m => m + '月'), axisLabel: { color: '#94a3b8' } },
        yAxis: { type: 'value', axisLabel: { color: '#94a3b8', formatter: v => (v / 10000) + '万' } },
        series: [
            { name: '目标', type: 'bar', data: months.map(m => appData.actuals[m].total.target_sales), itemStyle: { color: '#475569', borderRadius: [6, 6, 0, 0] } },
            { name: '实际(全月节奏)', type: 'line', smooth: true, data: months.map(m => { const a = appData.actuals[m]; return Math.round(a.total.sales / (a.time_progress / 100)); }), itemStyle: { color: '#22d3ee' }, lineStyle: { width: 3 } }
        ] });
    // 表
    let rows = '';
    SITES.forEach(s => { const d = A.by_site[s]; const c = cls(d.target_progress, d.time_progress);
        rows += `<tr><td>${s}</td><td>${fmtW(d.target_sales)}</td><td>${fmtW(d.sales)}</td>
            <td><span class="tag tag-${c}">${pct(d.target_progress)}</span></td><td>${pct(d.time_progress)}</td>
            <td>${gapTag(d.gap)}</td><td>${num(d.orders)}</td><td>${money(d.aov)}</td></tr>`; });
    document.getElementById('site-summary-table').innerHTML = rows;
    // 渠道/类目/分层
    const ch = safeInit('site-channel-chart');
    ch.setOption(pieOpt(CHANNELS.map(c => ({ name: c, value: A.total ? sumChannel(c) : 0 })), '销售额'));
    const ca = safeInit('site-category-chart');
    ca.setOption(pieOpt(CATS.map(c => ({ name: c, value: A.by_category[c].sales })), '销售额'));
    const la = safeInit('site-layer-chart');
    la.setOption(pieOpt(LAYERS.map(l => ({ name: l, value: A.by_layer[l].sales })), '销售额'));
}
function sumChannel(ch) { let s = 0; SITES.forEach(site => s += (A.by_site[site].channels[ch] || {}).sales || 0); return s; }

function pieOpt(data, name) {
    return { tooltip: { trigger: 'item', formatter: `{b}: {c} (${name})` }, legend: { bottom: 0, textStyle: { color: '#94a3b8' } },
        series: [{ type: 'pie', radius: ['38%', '66%'], center: ['50%', '45%'],
            data: data.map(d => ({ name: d.name, value: d.value, itemStyle: { color: layerColor[d.name] || siteColor[d.name] || undefined } })),
            label: { color: '#cbd5e1', formatter: '{b}\n{d}%' } }] };
}

/* ===================================================================
 * 站点 - 单店铺深度
 * =================================================================== */
let shopLayerChart = null;
function renderSiteDetail(site) {
    const d = A.by_site[site];
    document.getElementById('shop-detail-title').textContent = '🏪 ' + site + ' 店铺深度分析';
    document.getElementById('shop-detail-cards').innerHTML = targetHeroHTML({
        scope: '销售额', target: d.target_sales, actual: d.sales, orders: d.orders, aov: d.aov,
        mom: A.mom.by_site[site], momLabel: '当月环比', title: site + ' · 目标对照总览',
        meta: `目标进度 ${pct(d.target_progress)}`
    });
    // 渠道(双轴)
    shopLayerChart = null;
    const chc = safeInit('shop-channel-chart');
    chc.setOption(dualBar(CHANNELS, CHANNELS.map(c => d.channels[c].sales), CHANNELS.map(c => d.channels[c].orders), '销售额', '单量', c => siteColor[Object.keys(siteColor)[0]]));
    // 类目
    const cac = safeInit('shop-category-chart');
    cac.setOption(dualBar(CATS, CATS.map(c => d.categories[c].sales), CATS.map(c => d.categories[c].orders), '销售额', '单量'));
    // 分层(可点击)
    const lac = safeInit('shop-layer-chart');
    lac.setOption({ tooltip: { trigger: 'axis' }, grid: { left: 60, right: 50, top: 30, bottom: 30 },
        xAxis: { type: 'category', data: LAYERS, axisLabel: { color: '#94a3b8' } },
        yAxis: [{ type: 'value', name: '销售额', axisLabel: { color: '#94a3b8', formatter: v => (v / 10000) + '万' } },
                { type: 'value', name: '单量', axisLabel: { color: '#94a3b8' } }],
        series: [{ type: 'bar', name: '销售额', data: LAYERS.map(l => d.layers[l].sales), itemStyle: { color: p => layerColor[LAYERS[p.dataIndex]], borderRadius: [6, 6, 0, 0] }, barWidth: '45%' },
                 { type: 'line', name: '单量', yAxisIndex: 1, data: LAYERS.map(l => d.layers[l].orders), itemStyle: { color: '#f59e0b' } }] });
    lac.off('click'); lac.on('click', p => { state.shopLayer = p.name; renderShopSkuTable(site); document.getElementById('shop-layer-hint').textContent = '当前分层：' + p.name + '（点击其它层可切换）'; });
    // 明细表
    let rows = '';
    CHANNELS.forEach(c => { const v = d.channels[c]; rows += brkRow('渠道', c, v.sales, v.orders, d.sales); });
    CATS.forEach(c => { const v = d.categories[c]; rows += brkRow('类目', c, v.sales, v.orders, d.sales); });
    LAYERS.forEach(l => { const v = d.layers[l]; rows += brkRow('分层', l, v.sales, v.orders, d.sales); });
    document.getElementById('shop-breakdown-table').innerHTML = rows;
    document.getElementById('shop-layer-hint').textContent = '点击上方分层图查看该层单品';
    renderShopSkuTable(site);
}
function brkRow(dim, name, sales, orders, total) {
    const share = total ? (sales / total * 100).toFixed(1) : 0;
    return `<tr><td>${dim}</td><td>${name}</td><td class="num">${fmtW(sales)}</td><td class="num">${num(orders)}</td><td class="num">${share}%</td></tr>`;
}
function renderShopSkuTable(site) {
    const list = (appData.sku_master || []).filter(r => r.site === site && (state.shopLayer === 'all' || r.layer === state.shopLayer));
    list.sort((a, b) => b.actual_orders - a.actual_orders);
    let rows = '';
    list.slice(0, 60).forEach(r => {
        const prog = r.target_orders ? (r.actual_orders / r.target_orders * 100) : 0;
        rows += `<tr><td>${esc(r.ns_code)}</td><td>${r.category}</td><td>${r.layer}</td><td>${r.change_type}</td><td>${esc(r.owner)}</td>
            <td class="num">${num(r.target_orders)}</td><td class="num">${num(r.actual_orders)}</td>
            <td class="num"><span class="tag tag-${cls(prog)}">${pct(prog)}</span></td>
            <td><button class="btn btn-mini" onclick="openSkuModal('${esc(r.ns_code)}','${r.site}')">深度</button></td></tr>`;
    });
    document.getElementById('shop-sku-table').innerHTML = rows || '<tr><td colspan="9">无数据</td></tr>';
}
function dualBar(cats, salesArr, orderArr, sName, oName, colorFn) {
    return { tooltip: { trigger: 'axis' }, legend: { data: [sName, oName], textStyle: { color: '#94a3b8' } },
        grid: { left: 60, right: 50, top: 30, bottom: 30 },
        xAxis: { type: 'category', data: cats, axisLabel: { color: '#94a3b8' } },
        yAxis: [{ type: 'value', name: sName, axisLabel: { color: '#94a3b8', formatter: v => (v / 10000) + '万' } },
                { type: 'value', name: oName, axisLabel: { color: '#94a3b8' } }],
        series: [{ name: sName, type: 'bar', data: salesArr, itemStyle: { color: '#22d3ee', borderRadius: [6, 6, 0, 0] }, barWidth: '45%' },
                 { name: oName, type: 'line', yAxisIndex: 1, data: orderArr, itemStyle: { color: '#f59e0b' } }] };
}

/* ===================================================================
 * 类目 - 汇总 + 深度
 * =================================================================== */
function renderCategoryAll() {
    const shop = document.getElementById('category-shop').value;
    let rows = '';
    CATS.forEach(c => {
        const d = A.by_category[c];
        const prog = d.target_progress;
        rows += `<div class="stat-card">
            <div class="stat-card-label">${c}</div>
            <div class="stat-card-value cyan">${fmtW(d.sales)}</div>
            <div class="stat-card-sub">目标 ${fmtW(d.target_sales)} · 进度 <span class="tag tag-${cls(prog, d.time_progress)}">${pct(prog)}</span></div>
            <div class="stat-card-sub">环比 ${pct(A.mom.by_category[c])} ${A.mom.by_category[c] >= 0 ? '↑' : '↓'} · 单量 ${num(d.orders)}</div>
        </div>`;
    });
    document.getElementById('category-cards').innerHTML = rows;
    // 分店铺类目进度(分组柱)
    const csc = safeInit('category-shop-chart');
    csc.setOption({ tooltip: { trigger: 'axis' }, legend: { data: CATS, textStyle: { color: '#94a3b8' } },
        grid: { left: 60, right: 20, top: 30, bottom: 30 },
        xAxis: { type: 'category', data: SITES, axisLabel: { color: '#94a3b8' } },
        yAxis: { type: 'value', axisLabel: { color: '#94a3b8', formatter: v => (v / 10000) + '万' } },
        series: CATS.map((c, i) => ({ name: c, type: 'bar', data: SITES.map(s => (shop === '全部店铺' || shop === s) ? A.by_category[c].by_site[s].sales : 0), itemStyle: { color: Object.values(layerColor)[i], borderRadius: [4, 4, 0, 0] } })) });
}
function renderCategoryDetail(cat) {
    const shop = document.getElementById('cat-detail-shop').value || '全部店铺';
    const layerF = document.getElementById('cat-detail-layer').value || '全部层级';
    const d = A.by_category[cat];
    // 从 sku_master 真实聚合(支持店铺/分层二次切分)
    const list = (appData.sku_master || []).filter(r => r.category === cat && (shop === '全部店铺' || r.site === shop) && (layerF === '全部层级' || r.layer === layerF));
    const sales = list.reduce((s, r) => s + r.actual_sales, 0);
    const orders = list.reduce((s, r) => s + r.actual_orders, 0);
    const targetSales = list.reduce((s, r) => s + (r.target_orders || 0) * r.aov, 0);
    const targetOrders = list.reduce((s, r) => s + (r.target_orders || 0), 0);
    const prog = targetSales ? (sales / targetSales * 100) : 0;
    const gap = sales - targetSales * state.timeProgress / 100;
    const aov = orders ? sales / orders : 0;
    document.getElementById('cat-detail-title').textContent = ({ '飞机杯': '☕', '增大器': '💪', '龟头训练器': '🔵' }[cat] || '📦') + ' ' + cat + (shop === '全部店铺' ? '' : ' · ' + shop);
    document.getElementById('cat-detail-cards').innerHTML = targetHeroHTML({
        scope: '销售额', target: targetSales, actual: sales, orders: orders, aov: aov,
        mom: A.mom.by_category[cat], momLabel: '月度环比', title: cat + ' · 目标对照总览',
        meta: `${orders} 单 · 客单价 ${money(aov)}` + (shop === '全部店铺' ? '' : ' · ' + shop)
    });
    // 结构单量
    const sc = safeInit('cat-detail-structure-chart');
    const layersToShow = layerF === '全部层级' ? LAYERS : [layerF];
    sc.setOption(barOpt(layersToShow, layersToShow.map(l => list.filter(r => r.layer === l).reduce((s, r) => s + r.actual_orders, 0)), '单量', l => layerColor[l]));
    // 渠道单量
    const cc = safeInit('cat-detail-channel-chart');
    cc.setOption(barOpt(CHANNELS, CHANNELS.map(c => list.filter(r => r.channel === c).reduce((s, r) => s + r.actual_orders, 0)), '单量'));
    // 分店铺单量
    const shc = safeInit('cat-detail-shop-chart');
    const shopsToShow = shop === '全部店铺' ? SITES : [shop];
    shc.setOption(barOpt(shopsToShow, shopsToShow.map(s => list.filter(r => r.site === s).reduce((s, r) => s + r.actual_orders, 0)), '单量', s => siteColor[s]));
    // 重点单品
    list.sort((a, b) => b.actual_orders - a.actual_orders);
    document.getElementById('cat-detail-focus-sub').textContent = `共 ${list.length} 个单品 · 点击货号看本周期深度`;
    let rows = '';
    list.slice(0, 40).forEach(r => {
        const p = r.target_orders ? (r.actual_orders / r.target_orders * 100) : 0;
        rows += `<tr><td>${esc(r.ns_code)}</td><td>${r.site}</td><td>${esc(r.owner)}</td>
            <td class="num">${num(r.last_month_sales)}</td><td class="num">${num(r.target_orders)}</td>
            <td class="num">${num(r.actual_orders)}</td><td class="num"><span class="tag tag-${cls(p)}">${pct(p)}</span></td>
            <td>${r.layer}</td><td>${r.change_type}</td>
            <td><button class="btn btn-mini" onclick="openSkuModal('${esc(r.ns_code)}','${r.site}')">深度</button></td></tr>`;
    });
    document.getElementById('cat-detail-focus-body').innerHTML = rows || '<tr><td colspan="10">无数据</td></tr>';
}
function barOpt(cats, data, name, colorFn) {
    return { tooltip: { trigger: 'axis' }, grid: { left: 60, right: 20, top: 20, bottom: 30 },
        xAxis: { type: 'category', data: cats, axisLabel: { color: '#94a3b8' } },
        yAxis: { type: 'value', name: name, axisLabel: { color: '#94a3b8' } },
        series: [{ type: 'bar', data: data.map((v, i) => ({ value: v, itemStyle: { color: colorFn ? colorFn(cats[i]) : '#22d3ee', borderRadius: [6, 6, 0, 0] } })), barWidth: '50%' }] };
}

/* ===================================================================
 * 商品 - 全部 + 分层
 * =================================================================== */
function renderProductAll() {
    const shop = document.getElementById('product-shop').value || '全部店铺';
    const layerF = document.getElementById('product-layer').value || '全部层级';
    const list = (appData.sku_master || []).filter(r => (shop === '全部店铺' || r.site === shop) && (layerF === '全部层级' || r.layer === layerF));
    const pc = safeInit('product-structure-chart');
    pc.setOption(pieOpt(LAYERS.map(l => ({ name: l, value: list.filter(r => r.layer === l).reduce((s, r) => s + r.actual_sales, 0) })), '销售额'));
    const pt = safeInit('product-trend-chart');
    const actual = LAYERS.map(l => list.filter(r => r.layer === l).reduce((s, r) => s + r.actual_sales, 0));
    const target = LAYERS.map(l => list.filter(r => r.layer === l).reduce((s, r) => s + (r.target_orders || 0) * r.aov, 0));
    pt.setOption({ tooltip: { trigger: 'axis' }, legend: { data: ['实际', '目标'], textStyle: { color: '#94a3b8' } },
        grid: { left: 60, right: 20, top: 30, bottom: 30 },
        xAxis: { type: 'category', data: LAYERS, axisLabel: { color: '#94a3b8' } },
        yAxis: { type: 'value', axisLabel: { color: '#94a3b8', formatter: v => (v / 10000) + '万' } },
        series: [{ name: '实际', type: 'bar', data: actual, itemStyle: { color: '#22d3ee', borderRadius: [6, 6, 0, 0] } },
                 { name: '目标', type: 'bar', data: target, itemStyle: { color: '#475569', borderRadius: [6, 6, 0, 0] } }] });
    list.sort((a, b) => b.actual_orders - a.actual_orders);
    let rows = '';
    list.slice(0, 80).forEach(r => {
        const prog = r.target_orders ? (r.actual_orders / r.target_orders * 100) : 0;
        rows += `<tr><td>${esc(r.ns_code)}</td><td>${r.category}</td><td>${r.site}</td>
            <td class="num">${num(r.target_orders)}</td><td class="num">${num(r.actual_orders)}</td>
            <td class="num"><span class="tag tag-${cls(prog)}">${pct(prog)}</span></td>
            <td>${r.layer}</td><td>${r.change_type}</td><td>${esc(r.owner)}</td>
            <td><button class="btn btn-mini" onclick="openSkuModal('${esc(r.ns_code)}','${r.site}')">深度</button></td></tr>`;
    });
    document.getElementById('product-table-body').innerHTML = rows || '<tr><td colspan="10">无数据</td></tr>';
}
function renderProductLayer(layer) {
    const d = A.by_layer[layer];
    document.getElementById('pl-title').textContent = ({ '超爆': '🔥', '爆款': '⚡', '头部': '🥇', '腰部': '🥈', '尾部': '🥉' }[layer] || '📦') + ' ' + layer + '商品';
    document.getElementById('pl-cards').innerHTML = targetHeroHTML({
        scope: '单量', target: d.target_orders, actual: d.orders,
        title: layer + '商品 · 目标对照总览',
        meta: `${num(d.sku_count)} 个SKU · 销售额 ${fmtW(d.sales)} · 转化率 ${pct(d.conv * 100)}`
    });
    const sc = safeInit('pl-shop-chart');
    sc.setOption({ tooltip: { trigger: 'axis' }, legend: { data: ['销售额', '单量'], textStyle: { color: '#94a3b8' } },
        grid: { left: 60, right: 50, top: 30, bottom: 30 },
        xAxis: { type: 'category', data: SITES, axisLabel: { color: '#94a3b8' } },
        yAxis: [{ type: 'value', name: '销售额', axisLabel: { color: '#94a3b8', formatter: v => (v / 10000) + '万' } },
                { type: 'value', name: '单量', axisLabel: { color: '#94a3b8' } }],
        series: [{ name: '销售额', type: 'bar', data: SITES.map(s => d.by_site[s].sales), itemStyle: { color: '#22d3ee', borderRadius: [6, 6, 0, 0] }, barWidth: '40%' },
                 { name: '单量', type: 'line', yAxisIndex: 1, data: SITES.map(s => d.by_site[s].orders), itemStyle: { color: '#f59e0b' } }] });
    const cc = safeInit('pl-conv-chart');
    cc.setOption(barOpt(SITES, SITES.map(s => { const g = (appData.sku_master || []).filter(r => r.layer === layer && r.site === s); const o = g.reduce((s, r) => s + r.actual_orders, 0); const c = g.reduce((s, r) => s + r.conv * r.actual_orders, 0); return o ? +((c / o * 100).toFixed(2)) : 0; }), '转化率%', s => siteColor[s]));
    const list = (appData.sku_master || []).filter(r => r.layer === layer);
    list.sort((a, b) => b.actual_orders - a.actual_orders);
    let rows = '';
    list.slice(0, 60).forEach(r => {
        const prog = r.target_orders ? (r.actual_orders / r.target_orders * 100) : 0;
        rows += `<tr><td>${esc(r.ns_code)}</td><td>${r.category}</td><td>${r.site}</td>
            <td class="num">${num(r.target_orders)}</td><td class="num">${num(r.actual_orders)}</td>
            <td class="num"><span class="tag tag-${cls(prog)}">${pct(prog)}</span></td>
            <td>${pct(r.conv * 100)}</td><td>${r.change_type}</td><td>${esc(r.owner)}</td>
            <td><button class="btn btn-mini" onclick="openSkuModal('${esc(r.ns_code)}','${r.site}')">深度</button></td></tr>`;
    });
    document.getElementById('pl-sku-table').innerHTML = rows || '<tr><td colspan="10">无数据</td></tr>';
}

/* ===================================================================
 * 单品深度下钻
 * =================================================================== */
function openSkuModal(code, site) {
    const r = (appData.sku_index || {})[code + '|' + site];
    if (!r) { alert('未找到该单品数据'); return; }
    document.getElementById('sku-modal').style.display = 'flex';
    document.getElementById('sku-modal-title').textContent = '📦 ' + code + ' · ' + site;
    const prog = r.target_orders ? (r.actual_orders / r.target_orders * 100) : 0;
    const tpProg = state.timeProgress;
    document.getElementById('sku-modal-metrics').innerHTML =
        card('本周期销售额', fmtW(r.actual_sales), `截止 ${state.cutoff.slice(5)}`, 'cyan') +
        card('本周期单量', num(r.actual_orders), `目标单量 ${num(r.target_orders)}`, 'blue') +
        card('目标进度', pct(prog), `时间进度 ${pct(tpProg)}`, cls(prog, tpProg)) +
        card('转化率', pct(r.conv * 100), `客单价 ${money(r.aov)}`, 'green') +
        card('定位', r.layer, '预估 ' + (r.est_layer || '-'), '') +
        card('变化类型', r.change_type, '上月 ' + num(r.last_month_sales), '') +
        card('类目', r.category, '负责人 ' + esc(r.owner), '') +
        card('超前/滞后', (Math.round(r.actual_orders - r.target_orders * tpProg / 100) >= 0 ? '+' : '') + num(Math.round(r.actual_orders - r.target_orders * tpProg / 100)), '单量口径', Math.round(r.actual_orders - r.target_orders * tpProg / 100) >= 0 ? 'green' : 'red');
    document.getElementById('sku-modal-extra').innerHTML =
        `<div style="font-size:12px;color:var(--radium-text-muted);">渠道：${r.channel} ｜ 备注：${esc(r.remark) || '—'}</div>`;
    const sc = safeInit('sku-series-chart');
    const ser = r.series || [];
    sc.setOption({ tooltip: { trigger: 'axis' }, grid: { left: 50, right: 20, top: 20, bottom: 40 },
        xAxis: { type: 'category', data: ser.map(s => s.date), axisLabel: { color: '#94a3b8', rotate: 45 } },
        yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
        series: [{ type: 'line', smooth: true, data: ser.map(s => s.qty), areaStyle: { opacity: 0.15 }, itemStyle: { color: '#22d3ee' }, lineStyle: { width: 2 } }] });
}
function closeSkuModal() { document.getElementById('sku-modal').style.display = 'none'; }

/* ===================================================================
 * 重点单品监控（自定义周期 + 目标单量）
 * =================================================================== */
function getFocusConfig() { return JSON.parse(localStorage.getItem('focusConfig') || 'null'); }
function renderProductFocus() {
    const cfg = getFocusConfig();
    const box = document.getElementById('focus-product-list');
    if (!cfg || !cfg.length) {
        box.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎯</div>
            <div class="empty-state-title">暂无重点单品</div>
            <div class="empty-state-desc">点击"重点单品配置"，搜索并勾选需要监控的 SKU（支持按预估TopN批量选）</div></div>`;
        return;
    }
    const start = state.focusCycle.start, end = state.focusCycle.end;
    const cycDays = Math.max(1, (new Date(end) - new Date(start)) / 86400000 + 1);
    let html = `<div class="filter-bar" style="margin-bottom:16px;">
        <div class="filter-group"><span class="filter-label">监控周期</span>
            <input type="date" class="filter-select" id="focus-start" value="${start}" onchange="updateFocusCycle()" style="width:auto;"></div>
        <div class="filter-group"><span class="filter-label">至</span>
            <input type="date" class="filter-select" id="focus-end" value="${end}" onchange="updateFocusCycle()" style="width:auto;"></div>
        <span style="font-size:12px;color:var(--radium-text-muted);align-self:center;">共 ${cycDays} 天 · 周期目标 = 月度目标 × (${cycDays}/${A_days()})</span>
    </div><div class="grid-2">`;
    cfg.forEach(item => {
        const r = (appData.sku_index || {})[item.code + '|' + item.site];
        if (!r) return;
        const partTarget = Math.round((r.target_orders || 0) * cycDays / A_days());
        const prog = partTarget ? (r.actual_orders / partTarget * 100) : 0;
        const lead = r.actual_orders - partTarget;
        html += `<div class="card"><div class="card-header" style="display:flex;justify-content:space-between;">
                <div class="card-title">${esc(item.code)}</div><span class="tag tag-cyan">${r.site}</span></div>
            <div class="card-body">
                <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
                    <div>类目：${r.category} · ${r.layer}</div><div>负责人：${esc(r.owner)}</div>
                    <div>周期目标单量：<b>${num(partTarget)}</b></div><div>实际单量：<b>${num(r.actual_orders)}</b></div>
                    <div>进度：<span class="tag tag-${cls(prog, 100)}">${pct(prog)}</span></div>
                    <div>超前/滞后：<span class="tag tag-${lead >= 0 ? 'green' : 'red'}">${lead >= 0 ? '+' : ''}${num(lead)}</span></div>
                    <div>转化率：${pct(r.conv * 100)}</div><div>本周期销售额：${fmtW(r.actual_sales)}</div>
                </div>
                <div style="margin-top:10px;text-align:right;"><button class="btn btn-mini" onclick="openSkuModal('${esc(item.code)}','${item.site}')">深度</button></div>
            </div></div>`;
    });
    html += '</div>';
    box.innerHTML = html;
}
function A_days() { return (A && A.days_in_month) || 31; }
function updateFocusCycle() {
    state.focusCycle.start = document.getElementById('focus-start').value;
    state.focusCycle.end = document.getElementById('focus-end').value;
    renderProductFocus();
}
function openFocusConfig() {
    document.getElementById('focus-product-modal').style.display = 'flex';
    renderFocusConfigList();
}
function closeFocusConfig() { document.getElementById('focus-product-modal').style.display = 'none'; }
function renderFocusConfigList() {
    const q = (document.getElementById('focus-search').value || '').trim().toLowerCase();
    const cfg = getFocusConfig() || [];
    const list = (appData.sku_master || []).filter(r => !q || (r.ns_code + r.site + r.category).toLowerCase().includes(q));
    list.sort((a, b) => b.actual_orders - a.actual_orders);
    const sel = new Set(cfg.map(c => c.code + '|' + c.site));
    let rows = '';
    list.slice(0, 120).forEach(r => {
        const checked = sel.has(r.ns_code + '|' + r.site) ? 'checked' : '';
        rows += `<tr><td><input type="checkbox" data-code="${esc(r.ns_code)}" data-site="${r.site}" ${checked}></td>
            <td>${esc(r.ns_code)}</td><td>${r.site}</td><td>${r.category}</td><td>${r.layer}</td>
            <td class="num">${num(r.target_orders)}</td><td class="num">${num(r.actual_orders)}</td></tr>`;
    });
    document.getElementById('focus-product-config').innerHTML = `<div style="overflow:auto;max-height:55vh;"><table class="data-table">
        <thead><tr><th></th><th>货号</th><th>站点</th><th>类目</th><th>定位</th><th class="num">目标</th><th class="num">实际</th></tr></thead>
        <tbody id="focus-cfg-body">${rows}</tbody></table></div>`;
}
function focusTopN() {
    const n = parseInt(document.getElementById('focus-top-n').value) || 20;
    const sorted = [...(appData.sku_master || [])].sort((a, b) => b.actual_orders - a.actual_orders).slice(0, n);
    const body = document.getElementById('focus-cfg-body');
    if (!body) return;
    sorted.forEach(r => { const cb = body.querySelector(`input[data-code="${CSS.escape(r.ns_code)}"][data-site="${r.site}"]`); if (cb) cb.checked = true; });
}
function saveFocusProducts() {
    const cbs = document.querySelectorAll('#focus-cfg-body input[type=checkbox]');
    const cfg = [];
    cbs.forEach(cb => { if (cb.checked) cfg.push({ code: cb.dataset.code, site: cb.dataset.site }); });
    localStorage.setItem('focusConfig', JSON.stringify(cfg));
    closeFocusConfig();
    renderProductFocus();
}

/* ===================================================================
 * 运营 / 投放动作（钉钉抓取示例 + 筛选）
 * =================================================================== */
function getOpsSample() {
    if (appData.__ops) return appData.__ops;
    const owners = ['刘玉辉', '刘锦霞', '张敏', '王浩'];
    const types = ['广告投放', '活动报名', 'Listing优化', '价格调整', '库存补货', '站外引流', '评价维护'];
    const cats = CATS; const statuses = ['已完成', '进行中', '待开始']; const effects = ['有效', '部分有效', '待观察'];
    const months = ['2026年6月', '2026年5月'];
    const arr = [];
    for (let i = 0; i < 120; i++) {
        const site = SITES[i % 4], cat = cats[i % 3], owner = owners[i % 4], type = types[i % types.length];
        const day = 1 + (i * 3) % 27; const mo = i % 3 === 0 ? '2026年6月' : months[i % 2];
        arr.push({ time: `${mo.slice(0, 4)}-${mo.slice(5, 7)}-${String(day).padStart(2, '0')}`, month: mo, site, cat, owner, type,
            desc: `${cat} ${type} - ${site}`, status: statuses[i % 3], effect: effects[i % 3] });
    }
    appData.__ops = arr; return arr;
}
function getAdsSample() {
    if (appData.__ads) return appData.__ads;
    const owners = ['刘玉辉', '刘锦霞', '陈晨', '李娜'];
    const chs = CHANNELS; const cats = CATS; const months = ['2026年6月', '2026年5月'];
    const arr = [];
    for (let i = 0; i < 90; i++) {
        const site = SITES[i % 4], ch = chs[i % 4], cat = cats[i % 3], owner = owners[i % 4];
        const day = 1 + (i * 4) % 27; const mo = i % 2 === 0 ? '2026年6月' : months[i % 2];
        const spend = 800 + (i * 137) % 5200; const click = 200 + (i * 53) % 3000; const conv = Math.round(click * (0.03 + (i % 5) * 0.01));
        arr.push({ time: `${mo.slice(0, 4)}-${mo.slice(5, 7)}-${String(day).padStart(2, '0')}`, month: mo, site, ch, cat, owner,
            spend, click, conv, roi: +(spend ? (conv * 80 / spend).toFixed(2) : 0) });
    }
    appData.__ads = arr; return arr;
}
function initFilters() {
    // 运营/投放月份与负责人
    const opsMonths = ['全部', ...new Set(getOpsSample().map(r => r.month))];
    document.getElementById('ops-month').innerHTML = opsMonths.map(m => `<option>${m}</option>`).join('');
    document.getElementById('ops-owner').innerHTML = ['全部', ...new Set(getOpsSample().map(r => r.owner))].map(o => `<option>${o}</option>`).join('');
    const adsMonths = ['全部', ...new Set(getAdsSample().map(r => r.month))];
    document.getElementById('ads-month').innerHTML = adsMonths.map(m => `<option>${m}</option>`).join('');
    document.getElementById('ads-owner').innerHTML = ['全部', ...new Set(getAdsSample().map(r => r.owner))].map(o => `<option>${o}</option>`).join('');
    document.getElementById('ads-channel').innerHTML = ['全部', ...CHANNELS].map(c => `<option>${c}</option>`).join('');
    ['ops-period', 'ops-month', 'ops-owner', 'ops-category', 'ads-period', 'ads-month', 'ads-owner', 'ads-channel',
     'category-shop', 'cat-detail-shop', 'cat-detail-layer', 'product-shop', 'product-layer'].forEach(id => {
        const el = document.getElementById(id); if (el) el.onchange = () => rerender();
    });
    const ow = document.getElementById('ogsms-week'); if (ow) ow.onchange = renderWeeklyReview;
    const mm = document.getElementById('monthly-month'); if (mm) mm.onchange = generateMonthlyReview;
}
function renderOps() {
    const period = document.getElementById('ops-period').value, month = document.getElementById('ops-month').value || '全部';
    const owner = document.getElementById('ops-owner').value || '全部', cat = document.getElementById('ops-category').value || '全部';
    let list = getOpsSample();
    if (month !== '全部') list = list.filter(r => r.month === month);
    if (owner !== '全部') list = list.filter(r => r.owner === owner);
    if (cat !== '全部') list = list.filter(r => r.cat === cat);
    document.getElementById('ops-count').textContent = `共 ${list.length} 条`;
    document.getElementById('ops-table-body').innerHTML = list.slice(0, 100).map(r =>
        `<tr><td>${r.time}</td><td>${r.site}</td><td>${r.cat}</td><td>${r.type}</td><td>${r.owner}</td>
         <td>${esc(r.desc)}</td><td><span class="tag tag-cyan">${r.status}</span></td><td>${r.effect}</td></tr>`).join('') || '<tr><td colspan="8">无数据</td></tr>';
}
function renderAds() {
    const month = document.getElementById('ads-month').value || '全部', owner = document.getElementById('ads-owner').value || '全部', ch = document.getElementById('ads-channel').value || '全部';
    let list = getAdsSample();
    if (month !== '全部') list = list.filter(r => r.month === month);
    if (owner !== '全部') list = list.filter(r => r.owner === owner);
    if (ch !== '全部') list = list.filter(r => r.ch === ch);
    const totSpend = list.reduce((s, r) => s + r.spend, 0), totConv = list.reduce((s, r) => s + r.conv, 0);
    const roi = totSpend ? (totConv * 80 / totSpend) : 0;
    document.getElementById('ads-count').textContent = `共 ${list.length} 条`;
    document.getElementById('ads-stat-cards').innerHTML =
        card('总花费', fmtW(totSpend), '', 'red') + card('总转化', num(totConv), '', 'blue') +
        card('平均ROI', roi.toFixed(2), '', 'green') + card('记录数', num(list.length), '', 'cyan');
    document.getElementById('ads-table-body').innerHTML = list.slice(0, 100).map(r =>
        `<tr><td>${r.time}</td><td>${r.site}</td><td>${r.ch}</td><td>${r.cat}</td>
         <td>${fmtW(r.spend)}</td><td>${num(r.click)}</td><td>${num(r.conv)}</td><td>${r.roi}</td></tr>`).join('') || '<tr><td colspan="8">无数据</td></tr>';
}

/* ===================================================================
 * OGSM 配置驱动 周复盘 / 月度复盘
 * =================================================================== */
function normalizeOgsm(cfg) {
    cfg.sections.forEach(s => {
        if (Array.isArray(s.metrics) && s.metrics.length) return;
        if (Array.isArray(s.fields)) s.metrics = s.fields.map(f => ({ name: f.label || f.key || '指标', source: f.source || '', formula: f.formula || '' }));
        else if (!Array.isArray(s.metrics)) s.metrics = [];
    });
    return cfg;
}
function defaultOgsmConfig() {
    return { sections: [
        { name: '销售目标达成', desc: '总盘与分店铺目标完成',
            metrics: [
                { name: '总销售额达成率', source: '站点汇总-实际销售额 / 目标销售额', formula: '实际÷目标×100%' },
                { name: '时间进度达标', source: '站点汇总-目标进度 vs 时间进度', formula: '目标进度−时间进度' },
                { name: '分店铺达标', source: '各站点-目标进度', formula: '逐站点实际÷目标' }
            ] },
        { name: '渠道与类目', desc: '渠道效率与类目结构',
            metrics: [
                { name: '渠道ROI', source: '投放动作-ROI', formula: '转化额÷花费' },
                { name: '类目完成', source: '类目汇总-各类目目标进度', formula: '实际÷目标' },
                { name: '环比增长', source: '类目汇总-环比', formula: '(本月节奏−上月)÷上月' }
            ] },
        { name: '单品运营', desc: '爆品维护与重点单品',
            metrics: [
                { name: '超爆/爆款达成', source: '商品层-超爆/爆款目标进度', formula: '实际÷目标' },
                { name: '重点单品监控', source: '重点单品监控-周期目标', formula: '实际÷周期目标' }
            ] }
    ] };
}
function openOgsmConfig() {
    document.getElementById('ogsm-config-modal').style.display = 'flex';
    document.getElementById('ogsm-config-note').textContent = '每月板块/指标可变：编辑后保存即生效；周复盘只填「完成字段D」与「检查字段」。';
    const ed = document.getElementById('ogsm-config-editor'); ed.innerHTML = '';
    appData.ogsm_config.sections.forEach((sec, i) => {
        const div = document.createElement('div'); div.style.cssText = 'border:1px solid var(--radium-border);border-radius:12px;padding:14px;margin-bottom:14px;';
        let mhtml = sec.metrics.map((m, j) => `<div style="display:grid;grid-template-columns:1.4fr 2fr 1.4fr 40px;gap:8px;margin-bottom:8px;align-items:center;">
            <input class="filter-select" value="${esc(m.name)}" onchange="ogsmSet(${i},${j},'name',this.value)">
            <input class="filter-select" value="${esc(m.source)}" onchange="ogsmSet(${i},${j},'source',this.value)" placeholder="数据源">
            <input class="filter-select" value="${esc(m.formula)}" onchange="ogsmSet(${i},${j},'formula',this.value)" placeholder="公式">
            <button class="btn btn-mini" onclick="ogsmDelMetric(${i},${j})">🗑</button></div>`).join('');
        div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <input class="filter-select" style="font-weight:600;max-width:260px;" value="${esc(sec.name)}" onchange="ogsmSetSec(${i},'name',this.value)">
            <button class="btn btn-mini" onclick="ogsmDelSec(${i})">删除板块</button></div>
            <input class="filter-select" value="${esc(sec.desc || '')}" onchange="ogsmSetSec(${i},'desc',this.value)" placeholder="板块说明" style="margin-bottom:8px;">
            <div id="ogsm-metrics-${i}">${mhtml}</div>
            <button class="btn btn-mini" onclick="ogsmAddMetric(${i})">➕ 指标</button>`;
        ed.appendChild(div);
    });
}
function ogsmSetSec(i, k, v) { appData.ogsm_config.sections[i][k] = v; }
function ogsmSet(i, j, k, v) { appData.ogsm_config.sections[i].metrics[j][k] = v; }
function ogsmAddMetric(i) { appData.ogsm_config.sections[i].metrics.push({ name: '新指标', source: '', formula: '' }); openOgsmConfig(); }
function ogsmDelMetric(i, j) { appData.ogsm_config.sections[i].metrics.splice(j, 1); openOgsmConfig(); }
function ogsmDelSec(i) { appData.ogsm_config.sections.splice(i, 1); openOgsmConfig(); }
function addOgsmSection() { appData.ogsm_config.sections.push({ name: '新板块', desc: '', metrics: [{ name: '新指标', source: '', formula: '' }] }); openOgsmConfig(); }
function saveOgsmConfig() { localStorage.setItem('ogsmConfig', JSON.stringify(appData.ogsm_config)); alert('OGSM 配置已保存'); }
function exportOgsmConfig() { download('ogsm_config.json', JSON.stringify(appData.ogsm_config, null, 2)); }
function importOgsmConfig() { document.getElementById('ogsm-import-box').style.display = 'block'; }
function applyOgsmImport() { try { appData.ogsm_config = JSON.parse(document.getElementById('ogsm-import-text').value); openOgsmConfig(); } catch (e) { alert('JSON 解析失败'); } }
function closeOgsmConfig() { document.getElementById('ogsm-config-modal').style.display = 'none'; }

function renderWeeklyReview() {
    const week = document.getElementById('ogsms-week').value;
    const saved = JSON.parse(localStorage.getItem('ogsm_' + state.month + '_' + week) || '{}');
    let html = `<div style="margin-bottom:12px;font-size:13px;color:var(--radium-text-muted);">周期：${week} · 月份：${state.month} · 截止 ${state.cutoff.slice(5)}</div>`;
    appData.ogsm_config.sections.forEach((sec, i) => {
        const metrics = sec.metrics || [];
        html += `<div class="ogsm-section" style="border:1px solid var(--radium-border);border-radius:12px;padding:16px;margin-bottom:16px;">
            <h3 style="margin:0 0 4px;color:var(--radium-text-strong);">${esc(sec.name)}</h3>
            <div style="font-size:12px;color:var(--radium-text-muted);margin-bottom:10px;">${esc(sec.desc || '')}</div>`;
        metrics.forEach((m, j) => {
            const key = i + '_' + j; const sv = saved[key] || {};
            html += `<div style="margin-bottom:12px;padding:10px;background:rgba(255,255,255,0.03);border-radius:8px;">
                <div style="font-weight:600;margin-bottom:4px;">${esc(m.name)}</div>
                <div style="font-size:11px;color:var(--radium-text-muted);margin-bottom:8px;">数据源：${esc(m.source)} ｜ 公式：${esc(m.formula)}</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                    <div><label style="font-size:12px;color:#22d3ee;">完成字段 D（衡量完成情况）</label>
                        <textarea class="filter-select" id="d_${key}" style="width:100%;height:54px;margin-top:4px;">${esc(sv.D || '')}</textarea></div>
                    <div><label style="font-size:12px;color:#fb7185;">检查字段（落后原因分析）</label>
                        <textarea class="filter-select" id="c_${key}" style="width:100%;height:54px;margin-top:4px;">${esc(sv.check || '')}</textarea></div>
                </div></div>`;
        });
        html += `</div>`;
    });
    document.getElementById('ogsms-report').innerHTML = html;
}
function saveWeeklyReview() {
    const week = document.getElementById('ogsms-week').value;
    const out = {};
    appData.ogsm_config.sections.forEach((sec, i) => sec.metrics.forEach((m, j) => {
        const key = i + '_' + j; out[key] = { D: (document.getElementById('d_' + key) || {}).value || '', check: (document.getElementById('c_' + key) || {}).value || '' };
    }));
    localStorage.setItem('ogsm_' + state.month + '_' + week, JSON.stringify(out));
    alert('已保存「' + state.month + '月 ' + week + '」填写（覆盖同周）');
}
function copyOGSMContent() {
    const txt = document.getElementById('ogsms-report').innerText;
    navigator.clipboard.writeText(txt).then(() => alert('已复制周复盘内容'));
}
function generateMonthlyReview() {
    const m = document.getElementById('monthly-month').value || state.month;
    const a = appData.actuals[m]; const tgt = a.total.target_sales;
    let html = `<h2 style="color:var(--radium-text-strong);">${m} 月度复盘</h2>
        <p style="color:var(--radium-text-muted);">截止口径：${a.cutoff} ｜ 时间进度 ${pct(a.time_progress)} ｜ 达成率 ${a.attainment || '-'}%</p>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0;">
            ${card('总销售额', fmtW(a.total.sales), '', 'cyan')}
            ${card('目标销售额', fmtW(tgt), '', 'blue')}
            ${card('目标进度', pct(a.total.target_progress), '', cls(a.total.target_progress, a.time_progress))}
            ${card('超前/滞后', (a.total.gap >= 0 ? '+' : '-') + fmtW(Math.abs(a.total.gap)), '', a.total.gap >= 0 ? 'green' : 'red')}
        </div>
        <h3 style="color:var(--radium-text-strong);margin-top:18px;">一、分店铺达成</h3><table class="data-table"><thead><tr><th>站点</th><th>目标</th><th>实际</th><th>进度</th><th>超前/滞后</th></tr></thead><tbody>
        ${SITES.map(s => { const d = a.by_site[s]; return `<tr><td>${s}</td><td>${fmtW(d.target_sales)}</td><td>${fmtW(d.sales)}</td><td><span class="tag tag-${cls(d.target_progress, d.time_progress)}">${pct(d.target_progress)}</span></td><td>${gapTag(d.gap)}</td></tr>`; }).join('')}</tbody></table>
        <h3 style="color:var(--radium-text-strong);margin-top:18px;">二、类目达成与环比</h3><table class="data-table"><thead><tr><th>类目</th><th>实际</th><th>目标</th><th>进度</th><th>环比(节奏)</th></tr></thead><tbody>
        ${CATS.map(c => { const d = a.by_category[c]; const mom = (appData.actuals[m].mom ? appData.actuals[m].mom.by_category[c] : 0) || 0; return `<tr><td>${c}</td><td>${fmtW(d.sales)}</td><td>${fmtW(d.target_sales)}</td><td><span class="tag tag-${cls(d.target_progress, d.time_progress)}">${pct(d.target_progress)}</span></td><td>${pct(mom)}</td></tr>`; }).join('')}</tbody></table>
        <h3 style="color:var(--radium-text-strong);margin-top:18px;">三、商品结构</h3><table class="data-table"><thead><tr><th>分层</th><th>销售额</th><th>单量</th><th>转化率</th><th>目标进度</th></tr></thead><tbody>
        ${LAYERS.map(l => { const d = a.by_layer[l]; return `<tr><td>${l}</td><td>${fmtW(d.sales)}</td><td>${num(d.orders)}</td><td>${pct(d.conv * 100)}</td><td>${pct(d.target_progress)}</td></tr>`; }).join('')}</tbody></table>
        <h3 style="color:var(--radium-text-strong);margin-top:18px;">四、问题分析与下月计划</h3>
        <div style="padding:12px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:13px;line-height:1.8;">
        · 总体进度${pct(a.total.target_progress)}，相对时间进度${pct(a.time_progress)}${a.total.gap >= 0 ? '（超前达成）' : '（滞后，需追赶）'}。<br>
        · 落后站点：${SITES.filter(s => a.by_site[s].gap < 0).map(s => s + '(' + fmtW(a.by_site[s].gap) + ')').join('、') || '无'}。<br>
        · 重点策略建议：使用「策略生成器」基于历史有效策略库匹配本月优化动作。</div>`;
    document.getElementById('monthly-report-detail').innerHTML = html;
}
function copyMonthlyContent() { navigator.clipboard.writeText(document.getElementById('monthly-report-detail').innerText).then(() => alert('已复制月度复盘')); }

/* ===================================================================
 * 策略生成器 / 库
 * =================================================================== */
const PURPOSE_MAP = { '新品起量': ['起量', '新品', '冷启', '破零'], '老品重造': ['重造', '老品', '激活', '唤醒'], '爆款维护': ['维护', '爆款', '稳定', '防守'], '转化率提升': ['转化', '转化率', '详情', '信任'], '客单价提升': ['客单', '连带', '凑单', '套组'], '库存清理': ['库存', '清仓', '清理', '尾货'] };
function scoreStrategy(s, purpose, site, idea) {
    let score = 0; const sig = [];
    (PURPOSE_MAP[purpose] || []).forEach(k => { if ((s.name + s.type + s.why).includes(k)) { score += 12; sig.push(k); } });
    if (s.type) score += 8;
    if (s.priority === 'P0-必做') score += 25; else if (s.priority === 'P1-建议') score += 12;
    if (s.effect === '有效') score += 20; else if (s.effect === '部分有效') score += 10;
    if (site && s.shop && s.shop.includes(site)) score += 12;
    if (idea) { (idea.match(/[一-龥]{2,}/g) || []).forEach(w => { if ((s.name + s.type + s.why).includes(w)) score += 6; }); }
    return { score, sig };
}
function generateStrategy() {
    const purpose = document.getElementById('strategy-purpose').value;
    const site = document.getElementById('strategy-site').value;
    const cat = document.getElementById('strategy-category').value;
    const idea = document.getElementById('strategy-idea').value;
    const ranked = appData.strategies.map(s => ({ s, ...scoreStrategy(s, purpose, site, idea) }))
        .filter(x => x.sig.length > 0 || x.score > 30).sort((a, b) => b.score - a.score).slice(0, 5);
    const box = document.getElementById('strategy-result');
    if (!ranked.length) { box.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-title">未匹配到强相关策略</div><div class="empty-state-desc">可调整目的/想法，或在策略库中补充相关策略</div></div>`; return; }
    box.innerHTML = ranked.map((x, i) => `<div class="card" style="margin-bottom:12px;">
        <div class="card-header" style="display:flex;justify-content:space-between;">
            <div class="card-title">${i + 1}. ${esc(x.s.name)}</div>
            <span class="tag tag-${x.s.effect === '有效' ? 'green' : x.s.effect === '部分有效' ? 'cyan' : 'red'}">${x.s.effect}</span></div>
        <div class="card-body" style="font-size:13px;line-height:1.7;">
            <div>🎯 成功率评定：<b>${x.score}</b>/100 ｜ 优先级 ${esc(x.s.priority)}</div>
            <div>✨ 关键事项：${(x.s.keyPoints || []).map(k => '·' + esc(k)).join(' ') || '—'}</div>
            <div>💡 为什么用这个策略：${esc(x.s.why)}</div>
            <div>📐 如何写成OGSM：${esc(x.s.ogsm)}</div>
        </div></div>`).join('');
    renderStrategyCharts();
}
function renderStrategyGen() { renderStrategyCharts(); }
function renderStrategyCharts() {
    const str = appData.strategies;
    document.getElementById('stat-total').textContent = str.length;
    document.getElementById('stat-effective').textContent = str.filter(s => ['有效', '部分有效'].includes(s.effect)).length;
    document.getElementById('stat-pending').textContent = str.filter(s => ['待观察', '无效', '待验证'].includes(s.effect)).length;
    const avg = str.reduce((s, x) => s + x.score, 0) / (str.length || 1);
    document.getElementById('stat-rate').textContent = avg.toFixed(1);
    const types = [...new Set(str.map(s => s.type).filter(Boolean))];
    const tc = safeInit('strategy-type-chart');
    tc.setOption({ tooltip: { trigger: 'item' }, legend: { bottom: 0, textStyle: { color: '#94a3b8' } },
        series: [{ type: 'pie', radius: ['38%', '66%'], center: ['50%', '45%'],
            data: types.map(t => ({ name: t, value: str.filter(s => s.type === t).length })), label: { color: '#cbd5e1', formatter: '{b}\n{d}%' } }] });
    const sc = safeInit('strategy-success-chart');
    sc.setOption({ tooltip: { trigger: 'axis' }, grid: { left: 60, right: 20, top: 20, bottom: 40 },
        xAxis: { type: 'category', data: types, axisLabel: { color: '#94a3b8', rotate: 30 } },
        yAxis: { type: 'value', max: 100, axisLabel: { color: '#94a3b8', formatter: v => v + '%' } },
        series: [{ type: 'bar', data: types.map(t => { const g = str.filter(s => s.type === t); const eff = g.filter(s => s.effect === '有效').length; const pe = g.filter(s => s.effect === '部分有效').length; return Math.round((eff + pe * 0.5) / g.length * 100); }), itemStyle: { color: '#22d3ee', borderRadius: [6, 6, 0, 0] } }] });
}
function renderStrategyLib() {
    const typeSel = document.getElementById('lib-type');
    const evalSel = document.getElementById('lib-eval');
    const types = ['全部', ...new Set(appData.strategies.map(s => s.type).filter(Boolean))];
    const evals = ['全部', '有效', '部分有效', '待观察', '无效', '待验证'];
    if (typeSel.options.length <= 1) { typeSel.innerHTML = types.map(t => `<option>${t}</option>`).join(''); evalSel.innerHTML = evals.map(e => `<option>${e}</option>`).join(''); }
    typeSel.onchange = renderStrategyLib; evalSel.onchange = renderStrategyLib;
    const tf = typeSel.value, ef = evalSel.value;
    const list = appData.strategies.filter(s => (tf === '全部' || s.type === tf) && (ef === '全部' || s.effect === ef));
    document.getElementById('strategy-library-list').innerHTML = list.map((s, i) => `<div class="card" style="margin-bottom:10px;">
        <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;">
            <div class="card-title">${esc(s.name)}</div>
            <div><span class="tag tag-${s.effect === '有效' ? 'green' : s.effect === '部分有效' ? 'cyan' : 'red'}">${s.effect}</span>
                <span class="tag tag-blue">评分${s.score}</span>
                <button class="btn btn-mini" onclick="rateStrategy(${i})">评分</button></div>
        </div>
        <div class="card-body" style="font-size:13px;line-height:1.7;">
            <div>类型：${esc(s.type)} ｜ 阶段：${esc(s.stage)} ｜ 优先级：${esc(s.priority)}</div>
            <div>关键事项：${(s.keyPoints || []).map(k => '·' + esc(k)).join(' ') || '—'}</div>
            <div>推荐理由：${esc(s.why)}</div></div></div>`).join('') || '<div class="empty-state">无匹配策略</div>';
}
function rateStrategy(i) { const v = prompt('请输入评分(0-100)：', appData.strategies[i].score); if (v != null) { appData.strategies[i].score = parseInt(v) || 0; renderStrategyLib(); } }
function openStrategyModal() { document.getElementById('strategy-modal').style.display = 'flex'; document.getElementById('strategy-modal-title').textContent = '➕ 添加策略'; }
function closeStrategyModal() { document.getElementById('strategy-modal').style.display = 'none'; }
function submitStrategy() {
    const s = { name: document.getElementById('sm-name').value, type: document.getElementById('sm-type').value, stage: document.getElementById('sm-stage').value,
        priority: document.getElementById('sm-priority').value, evaluation: document.getElementById('sm-effect').value,
        actions: document.getElementById('sm-keypoints').value, reason: document.getElementById('sm-why').value, ogsm: document.getElementById('sm-ogsm').value,
        shop: '', category: '', score: document.getElementById('sm-priority').value === 'P0-必做' ? 90 : 75 };
    const added = JSON.parse(localStorage.getItem('addedStrategies') || '[]'); added.push(s); localStorage.setItem('addedStrategies', JSON.stringify(added));
    appData.strategies = added.concat(appData.strategies);
    closeStrategyModal(); renderStrategyLib(); renderStrategyCharts();
}
function exportStrategies() { download('strategies.json', JSON.stringify(appData.strategies, null, 2)); }
function download(name, text) { const b = new Blob([text], { type: 'application/json' }); const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = name; a.click(); URL.revokeObjectURL(u); }

/* ===================================================================
 * 汇率
 * =================================================================== */
function openExchangeModal() { document.getElementById('exchange-modal').style.display = 'flex'; }
function closeExchangeModal() { document.getElementById('exchange-modal').style.display = 'none'; }
function saveExchangeRates() {
    exchangeRates = { 'AC美': +document.getElementById('exchange-ac').value, 'BV美': +document.getElementById('exchange-bv').value,
        'UK英': +document.getElementById('exchange-uk').value, 'EU欧': +document.getElementById('exchange-eu').value };
    localStorage.setItem('exchangeRates', JSON.stringify(exchangeRates));
    alert('汇率已保存'); rerender();
}

/* 窗口缩放重绘 */
window.addEventListener('resize', () => { chartRegistry.forEach(c => { try { c.resize(); } catch (e) {} }); });
