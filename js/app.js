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
const CHANNELS = ['SEM', 'EMAIL', '直访', 'SEO', '信息流', '联盟', '社媒', '其他'];
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
const rint = n => Math.round(n || 0);
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

/* 单品周期对比辅助：比率型差值用百分点(pp)，其它用相对% */
function fmtDur(sec) {
    sec = Math.round(sec || 0);
    if (sec < 60) return sec + '秒';
    const m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + '分' + (s ? s + '秒' : '');
    const h = Math.floor(m / 60);
    return h + '时' + (m % 60) + '分';
}
function deltaTag(f) {
    if (!f) return '<span class="tag">—</span>';
    if (f.is_rate) {
        const up = f.abs >= 0;
        return `<span class="tag tag-${up ? 'green' : 'red'}">${up ? '+' : '-'}${f.abs.toFixed(1)}pct</span>`;
    }
    if (f.rel == null) return '<span class="tag">—</span>';
    const up = f.rel >= 0;
    return `<span class="tag tag-${up ? 'green' : 'red'}">${up ? '+' : '-'}${f.rel.toFixed(1)}%</span>`;
}
function deltaSub(f, key) {
    if (!f) return '';
    if (f.is_rate) { const up = f.abs >= 0; return (up ? '+' : '-') + f.abs.toFixed(1) + 'pct'; }
    if (f.rel == null) return '环比 —';
    const up = f.rel >= 0; return (up ? '+' : '-') + f.rel.toFixed(1) + '%';
}
function deltaTone(f, key) {
    if (!f) return '';
    let up = f.is_rate ? (f.abs >= 0) : (f.rel == null ? false : f.rel >= 0);
    if (key === 'bounce' || key === 'exit_rate') up = !up; // 跳出/退出率升高为劣
    return up ? 'green' : 'red';
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
    const momTxt = (o.mom != null) ? `${pct(o.mom)}` : '';
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
          <div class="th-sub">${progressGap >= 0 ? '超前 ' : '滞后 '}${Math.abs(progressGap).toFixed(1)}%</div>
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
    weeks.forEach(wk => {
        const key = 'ogsm_' + state.month + '_' + wk;
        if (localStorage.getItem(key)) return;
        const out = {};
        cfg.sections.forEach((sec, i) => {
            const id = sec.id || i;
            const computed = computeOgsmData(sec);
            const d = `完成${fmtOgsmValue(computed.actual, computed.unit)}，目标${fmtOgsmValue(computed.target, computed.unit)}，进度${pct(computed.progress)}，${computed.status}${Math.abs(computed.gapPct).toFixed(1)}%`;
            const check = buildOgsmCheck(sec, computed);
            out[id] = { D: d, check: check };
        });
        try { localStorage.setItem(key, JSON.stringify(out)); } catch (e) {}
    });
}
function seedSampleFocus() {
    if (localStorage.getItem('focusConfig')) return;
    let cfg = [];
    const rp = appData.sku_period;
    if (rp && rp.skus) {
        const top = Object.values(rp.skus).sort((a, b) => b.current.sales - a.current.sales).slice(0, 6)
            .map(s => ({ code: s.sku, site: rp.site }));
        cfg = cfg.concat(top);
    }
    const demoTop = [...(appData.sku_master || [])].sort((a, b) => b.actual_orders - a.actual_orders).slice(0, 4)
        .map(r => ({ code: r.ns_code, site: r.site }));
    cfg = cfg.concat(demoTop);
    try { localStorage.setItem('focusConfig', JSON.stringify(cfg)); } catch (e) {}
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
    else if (page === 'review' && sub === 'ogsms') switchOgsmTab('real');
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
    document.getElementById('shop-detail-title').textContent = site + ' 店铺深度分析';
    document.getElementById('shop-detail-cards').innerHTML = targetHeroHTML({
        scope: '销售额', target: d.target_sales, actual: d.sales, orders: d.orders, aov: d.aov,
        mom: A.mom.by_site[site], momLabel: '当月环比', title: site + ' · 目标对照总览',
        meta: `目标进度 ${pct(d.target_progress)}`
    });
    // 渠道(双轴)
    shopLayerChart = null;
    const chc = safeInit('shop-channel-chart');
    chc.setOption(dualBar(CHANNELS, CHANNELS.map(c => rint(d.channels[c].sales)), CHANNELS.map(c => rint(d.channels[c].orders)), '销售额', '单量', c => siteColor[Object.keys(siteColor)[0]]));
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
    CHANNELS.forEach(c => { const v = d.channels[c]; rows += brkRow('渠道', c, rint(v.sales), rint(v.orders), d.sales); });
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
    const rotate = cats.length > 5 ? 30 : 0;
    return { tooltip: { trigger: 'axis' }, legend: { data: [sName, oName], textStyle: { color: '#94a3b8' } },
        grid: { left: 60, right: 50, top: 30, bottom: rotate ? 60 : 30 },
        xAxis: { type: 'category', data: cats, axisLabel: { color: '#94a3b8', rotate: rotate, interval: 0 } },
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
            <div class="stat-card-sub">环比 ${pct(A.mom.by_category[c])} ${A.mom.by_category[c] >= 0 ? '' : ''} · 单量 ${num(d.orders)}</div>
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
    document.getElementById('cat-detail-title').textContent = cat + (shop === '全部店铺' ? '' : ' · ' + shop);
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
    cc.setOption(barOpt(CHANNELS, CHANNELS.map(c => rint(list.reduce((s, r) => s + ((r.channels && r.channels[c] && r.channels[c].orders) || 0), 0))), '单量'));
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
    document.getElementById('pl-title').textContent = layer + '商品';
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
    const rp = appData.sku_period;
    const realR = rp && rp.skus ? rp.skus[code] : null;
    if (realR) { renderRealSkuModal(realR, rp); return; }
    const r = (appData.sku_index || {})[code + '|' + site];
    if (!r) { alert('未找到该单品数据'); return; }
    document.getElementById('sku-modal').style.display = 'flex';
    document.getElementById('sku-modal-title').textContent = code + ' · ' + site;
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
    const chParts = CHANNELS.filter(c => r.channels && r.channels[c] && r.channels[c].orders > 0)
        .sort((a, b) => r.channels[b].orders - r.channels[a].orders)
        .slice(0, 3).map(c => `${c} ${num(rint(r.channels[c].orders))}`);
    document.getElementById('sku-modal-extra').innerHTML =
        `<div style="font-size:12px;color:var(--radium-text-muted);">渠道（多通道）：${chParts.join(' / ') || '—'} ｜ 备注：${esc(r.remark) || '—'}</div>`;
    const scCard = document.getElementById('sku-series-card'); if (scCard) scCard.style.display = '';
    const st = document.getElementById('sku-series-title'); if (st) st.textContent = '近 11 周单量走势（本周期）';
    const sc = safeInit('sku-series-chart');
    const ser = r.series || [];
    sc.setOption({ tooltip: { trigger: 'axis' }, grid: { left: 50, right: 20, top: 20, bottom: 40 },
        xAxis: { type: 'category', data: ser.map(s => s.date), axisLabel: { color: '#94a3b8', rotate: 45 } },
        yAxis: { type: 'value', axisLabel: { color: '#94a3b8' } },
        series: [{ type: 'line', smooth: true, data: ser.map(s => s.qty), areaStyle: { opacity: 0.15 }, itemStyle: { color: '#22d3ee' }, lineStyle: { width: 2 } }] });
    renderSkuDeep(buildDemoCtx(r, code, site));
}
function renderRealSkuModal(s, rp) {
    document.getElementById('sku-modal').style.display = 'flex';
    document.getElementById('sku-modal-title').textContent = s.sku + ' · ' + rp.site;
    const c = s.current, dl = s.delta;
    let m = '';
    m += card('本周期销售额', money(c.sales), '均价 ' + money(c.avg_price), 'cyan');
    m += card('总单量', num(c.orders), '总数量 ' + num(c.qty), 'blue');
    m += card('转化率', pct(c.conv), deltaSub(dl.conv, 'conv'), deltaTone(dl.conv, 'conv'));
    m += card('加购率', pct(c.cart_rate), deltaSub(dl.cart_rate, 'cart_rate'), deltaTone(dl.cart_rate, 'cart_rate'));
    m += card('结账成功率', pct(c.checkout_rate), deltaSub(dl.checkout_rate, 'checkout_rate'), deltaTone(dl.checkout_rate, 'checkout_rate'));
    m += card('访问次数', num(c.visits), deltaSub(dl.visits, 'visits'), deltaTone(dl.visits, 'visits'));
    m += card('唯一访客', num(c.uv), '入口UV ' + num(c.entry_uv), '');
    m += card('加购数', num(c.add_cart), '立即购 ' + num(c.buy_now) + ' / 搭配 ' + num(c.bundle), '');
    m += card('停留时间', fmtDur(c.dwell_sec), '上架 ' + num(c.age_days) + ' 天', '');
    m += card('跳出率', pct(c.bounce), deltaSub(dl.bounce, 'bounce'), deltaTone(dl.bounce, 'bounce'));
    m += card('退出率', pct(c.exit_rate), deltaSub(dl.exit_rate, 'exit_rate'), deltaTone(dl.exit_rate, 'exit_rate'));
    document.getElementById('sku-modal-metrics').innerHTML = m;
    let ex = `<div style="font-size:12px;color:var(--radium-text-muted);margin-bottom:10px;">货号 ${esc(s.sku)} · ${rp.site} · ${esc(s.category)} ｜ <b>${esc(rp.period_current)}</b> vs <b>${esc(rp.period_prev)}</b>（逐字段环比）</div>`;
    if (s.previous) {
        ex += `<table class="period-delta-table"><thead><tr><th>指标</th><th>${esc(rp.period_current)}</th><th>${esc(rp.period_prev)}</th><th>变化</th></tr></thead><tbody>`;
        const rows = [
            ['总销售', dl.sales, money], ['总单量', dl.orders, num], ['转化率', dl.conv, pct],
            ['加购率', dl.cart_rate, pct], ['结账成功率', dl.checkout_rate, pct],
            ['访问次数', dl.visits, num], ['加购数', dl.add_cart, num], ['唯一访客', dl.uv, num],
        ];
        rows.forEach(function (rw) {
            const label = rw[0], f = rw[1], fmt = rw[2];
            ex += `<tr><td>${label}</td><td>${fmt(f.cur)}</td><td>${fmt(f.prev)}</td><td>${deltaTag(f)}</td></tr>`;
        });
        ex += `</tbody></table>`;
    } else {
        ex += `<div class="empty-state-desc">本周期数据，无上一周期对照</div>`;
    }
    document.getElementById('sku-modal-extra').innerHTML = ex;
    // 真实单品无 11 周序列数据，隐藏走势卡（仅演示单品展示该卡）
    const scCard = document.getElementById('sku-series-card'); if (scCard) scCard.style.display = 'none';
    renderSkuDeep(buildRealCtx(s, rp));
}
function closeSkuModal() { document.getElementById('sku-modal').style.display = 'none'; }
// ESC 关闭任意已打开的弹窗（含单品深度卡片）
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        ['sku-modal', 'focus-product-modal', 'ogsm-config-modal', 'strategy-modal', 'exchange-modal'].forEach(function (id) {
            const m = document.getElementById(id);
            if (m && m.style.display === 'flex') m.style.display = 'none';
        });
    }
});

/* ===================================================================
   单品深度分析 · 三大板块：运营动作 / 建议 / 相关联产品
   =================================================================== */
// 卖点词典（标题/类目 卖点标签），用于关联品判定与 OGSM 匹配
const SP_LEXICON = [
    ['旋转', 'rotat'], ['伸缩', 'telesc'], ['吸吮', 'suction'], ['震动', 'vibrat'],
    ['逼真', 'realistic'], ['自动', 'automat'], ['加热', 'heat'], ['静音', 'quiet'],
    ['充气', 'inflat'], ['真空', 'vacuum'], ['口袋', 'pocket'], ['娃娃', 'doll'],
    ['臀', 'butt'], ['阴道', 'vagina'], ['口交', 'oral'], ['电动', 'electric'],
    ['充电', 'recharge'], ['便携', 'portable'], ['硅胶', 'silicone'], ['tpe', 'tpe'],
    ['深喉', 'throat'], ['多档', 'multi'], ['远程', 'remote'], ['app', 'app'],
    ['飞机杯', 'masturbator'], ['吸盘', 'cup'], ['增大', 'enlarge'], ['男用', 'male'],
    ['女用', 'female'], ['情侣', 'couple'], ['震动棒', 'vibrator'], ['跳蛋', 'egg'],
    ['肛塞', 'plug'], ['前列腺', 'prostate'], ['润滑剂', 'lube'], ['穿戴', 'strap'],
];
function extractSellingPoints(text) {
    const t = (text || '').toLowerCase();
    const out = [];
    SP_LEXICON.forEach(function (p) {
        if (t.indexOf(p[0].toLowerCase()) >= 0 || (p[1] && t.indexOf(p[1].toLowerCase()) >= 0)) out.push(p[0]);
    });
    return out;
}
function _avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
// 本 vs 对照：高于/低于/持平
function cmp(a, b) {
    if (a == null || b == null) return 'flat';
    const d = a - b;
    if (Math.abs(d) <= Math.abs(b) * 0.02 + 1e-9) return 'flat';
    return d > 0 ? 'above' : 'below';
}
function cmpTag(kind) {
    if (kind === 'above') return '<span class="cmp-tag cmp-above">高于</span>';
    if (kind === 'below') return '<span class="cmp-tag cmp-below">低于</span>';
    return '<span class="cmp-tag cmp-flat">持平</span>';
}
// 真实单品池（BV美 本周期全量）
function realPool() {
    const sp = appData.sku_period;
    if (!sp || !sp.skus) return [];
    return Object.values(sp.skus).map(function (s) {
        return { sku: s.sku, name: s.name, category: s.category, current: s.current,
                 sellingPoints: extractSellingPoints((s.name || '') + ' ' + (s.category || '')) };
    });
}
// 演示单品池（同站点 sku_master）
function demoPool(site) {
    return (appData.sku_master || []).filter(function (r) { return r.site === site; }).map(function (r) {
        return { sku: r.ns_code, name: r.ns_code, category: r.category,
                 current: { sales: r.actual_sales, avg_price: r.aov, conv: r.conv, uv: null,
                            bounce: null, cart_rate: null, checkout_rate: null },
                 sellingPoints: extractSellingPoints(r.category || '') };
    });
}
// 相关联产品：同类目（必须）+ 同客单价（±30% 加权）+ 卖点相似（重叠数）
function relatedProducts(ctx, pool) {
    const focal = ctx;
    const sameCat = pool.filter(function (p) { return p.sku !== focal.sku && p.category === focal.category; });
    if (sameCat.length === 0) return { items: [], catAvg: null };
    const catAvg = {
        conv: _avg(sameCat.map(function (p) { return p.current.conv; })),
        sales: _avg(sameCat.map(function (p) { return p.current.sales; })),
        uv: _avg(sameCat.map(function (p) { return p.current.uv || 0; })),
        avg_price: _avg(sameCat.map(function (p) { return p.current.avg_price; })),
        bounce: _avg(sameCat.map(function (p) { return p.current.bounce || 0; })),
    };
    const fp = (focal.current.avg_price || 1);
    const fc = focal.current;
    const fsp = new Set(focal.sellingPoints);
    const scored = sameCat.map(function (p) {
        const priceDiff = Math.abs((p.current.avg_price || 0) - fp) / fp;
        const priceMatch = Math.max(0, 1 - priceDiff / 0.3);   // 30% 内线性
        const psp = new Set(p.sellingPoints);
        let overlap = 0; const overlapPts = [];
        fsp.forEach(function (k) { if (psp.has(k)) { overlap++; overlapPts.push(k); } });
        const score = priceMatch * 0.5 + (overlap > 0 ? 0.5 : 0) + overlap * 0.1;
        // 选品原因（为什么选它）
        const reasons = ['同类目'];
        const pdPct = priceDiff * 100;
        reasons.push(pdPct <= 30 ? ('客单价相近(差' + pdPct.toFixed(0) + '%)') : ('客单价差' + pdPct.toFixed(0) + '%'));
        if (overlap > 0) reasons.push('卖点相似:' + overlapPts.join('/'));
        if (fc.conv != null && p.current.conv != null) {
            const cd = Math.abs(fc.conv - p.current.conv) / Math.max(p.current.conv, 1e-9);
            if (cd <= 0.15) reasons.push('转化率接近');
        }
        if (fc.uv != null && p.current.uv != null && fc.uv > 0 && p.current.uv > 0) {
            const ur = Math.max(fc.uv, p.current.uv) / Math.min(fc.uv, p.current.uv);
            if (ur <= 1.3) reasons.push('UV接近');
        }
        return { p: p, priceDiff: priceDiff, overlap: overlap, score: score, reasons: reasons };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    const items = scored.slice(0, 6).map(function (o) {
        const p = o.p, cc = p.current;
        return {
            sku: p.sku, name: p.name, category: p.category,
            conv: cc.conv, sales: cc.sales, uv: cc.uv, avg_price: cc.avg_price,
            priceDiffPct: o.priceDiff * 100, overlap: o.overlap, reasons: o.reasons,
            cmpConv: cmp(fc.conv, cc.conv),
            cmpSales: cmp(fc.sales, cc.sales),
            cmpUv: cmp(fc.uv, cc.uv),
        };
    });
    return { items: items, catAvg: catAvg };
}
// OGSM 运营动作：本月 OGSM 计划里，落地店铺含本店 + 文本与本商品卖点/类目重叠
function matchOgsmActions(ctx) {
    const o = appData.ogsm_july;
    if (!o || !o.rows) return [];
    const site = ctx.site;
    const kws = ctx.sellingPoints.slice();
    (ctx.category || '').split(/[\s,\/&]+/).forEach(function (w) { if (w) kws.push(w); });
    const kwset = new Set(kws.map(function (k) { return (k || '').toLowerCase(); }));
    const out = [];
    o.rows.forEach(function (row) {
        if (site && row['落地店铺'] && row['落地店铺'].indexOf(site) < 0) return; // 店铺必须匹配
        if (!row['计划']) return;
        const blob = (row['板块'] + row['目的'] + row['目标'] + row['策略'] + row['衡量'] + row['计划']).toLowerCase();
        let score = 0;
        kwset.forEach(function (k) { if (k && blob.indexOf(k) >= 0) score++; });
        if (score > 0) out.push({ 板块: row['板块'], 策略: row['策略'], 计划: row['计划'], score: score });
    });
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 8);
}
// 建议：规则引擎（基于本商品数据 + 同类目均值 + 本 vs 上周期环比）
function buildSuggestions(ctx, catAvg) {
    const c = ctx.current, dl = ctx.delta;
    const bullets = [];
    // 1) 销售额环比
    if (dl && dl.sales && dl.sales.abs !== undefined) {
        const d = dl.sales.abs;
        if (d < 0) bullets.push({ t: `销售额环比下滑 ${money(-d)}（${pct(dl.sales.rel)}），建议从流量与转化两端排查下滑来源。` });
        else if (d > 0) bullets.push({ t: `销售额环比增长 ${money(d)}（${pct(dl.sales.rel)}），势头向好，建议趁势加投并稳住供给。` });
    }
    // 2) 转化率环比
    if (dl && dl.conv && dl.conv.abs !== undefined && dl.conv.abs < 0)
        bullets.push({ t: `转化率环比下降 ${pct(-dl.conv.abs)}，建议关注详情页卖点表达、价格竞争力与评价体系，优化加购下单链路。` });
    // 3) 低于同类目转化率
    if (catAvg && catAvg.conv && c.conv < catAvg.conv * 0.95)
        bullets.push({ t: `转化率 ${pct(c.conv)} 低于同类目均值 ${pct(catAvg.conv)}，矛盾在转化端，建议提升卖方信任度与流量精准度。` });
    // 4) 跳出率偏高
    if (catAvg && catAvg.bounce && c.bounce > catAvg.bounce * 1.05)
        bullets.push({ t: `跳出率 ${pct(c.bounce)} 高于同类目均值，建议优化首屏与移动端落地体验、统一素材与落地页。` });
    // 5) 加购不低但结账低
    if (c.cart_rate > 0 && c.checkout_rate > 0 && c.checkout_rate < 0.5)
        bullets.push({ t: `加购率 ${pct(c.cart_rate)} 不低但结账成功率 ${pct(c.checkout_rate)} 偏低，建议精简结账步骤、增加支付方式/本地化结算。` });
    // 6) 客单价偏离
    if (catAvg && catAvg.avg_price) {
        if (c.avg_price > catAvg.avg_price * 1.15)
            bullets.push({ t: `客单价 ${money(c.avg_price)} 高于同类目，建议通过搭配装/组合装提升性价比感知、降低决策门槛。` });
        else if (c.avg_price < catAvg.avg_price * 0.85)
            bullets.push({ t: `客单价 ${money(c.avg_price)} 低于同类目，建议用规格升级/套装上探价格带、提高件单价。` });
    }
    // 7) UV 充足但转化低
    if (c.uv > 0 && c.conv < (catAvg ? catAvg.conv : 1) * 0.95)
        bullets.push({ t: `访客 ${num(c.uv)} 不缺但转化偏弱，建议把流量质量（渠道/词）与落地承接一起复盘。` });
    if (bullets.length === 0) bullets.push({ t: `各项指标稳健，建议维持运营节奏并小幅测试增量动作（如关联搭配、评价运营）。` });
    const trendWord = (dl && dl.sales && dl.sales.abs >= 0) ? '环比上行' : '环比承压';
    const summary = `${esc(ctx.name || ctx.sku)}（${esc(ctx.category)}）本周期销售额 ${money(c.sales)}、转化率 ${pct(c.conv)}、访客 ${c.uv != null ? num(c.uv) : '—'}，整体${trendWord}；客单价 ${money(c.avg_price)}，加购率 ${c.cart_rate != null ? pct(c.cart_rate) : '—'}、结账成功率 ${c.checkout_rate != null ? pct(c.checkout_rate) : '—'}。`;
    return { summary: summary, bullets: bullets };
}
// 渲染三大板块到弹窗
function renderSkuDeep(ctx) {
    const pool = ctx.kind === 'real' ? realPool() : demoPool(ctx.site);
    const rel = relatedProducts(ctx, pool);
    const ogsm = matchOgsmActions(ctx);
    const sug = buildSuggestions(ctx, rel.catAvg);

    // —— ① 运营动作 ——
    let a = '<h4>运营动作 <span class="pill">2 类来源</span></h4>';
    a += '<div class="section-hint">实际运营动作 = 系统抓取（可能暂无）；OGSM 运营动作 = 本月 OGSM 计划（复盘抓取源）。</div>';
    a += '<div class="deep-sub">① 实际运营动作（系统抓取）</div>';
    if (ctx.realActions && ctx.realActions.length) {
        a += '<div class="action-list">' + ctx.realActions.map(function (x) {
            return `<div class="action-item"><div class="ai-head">${(esc(x.date) || '')} · ${(esc(x.source) || '抓取')}</div><div class="ai-body">${esc(x.action)}</div></div>`;
        }).join('') + '</div>';
    } else {
        a += '<div class="empty-note">无（当前周期未接入抓取源；接入后在此展示真实操作记录）。</div>';
    }
    a += '<div class="deep-sub">② OGSM 运营动作（本月计划）</div>';
    if (ogsm.length) {
        a += '<div class="action-list">' + ogsm.map(function (x) {
            return `<div class="action-item"><div class="ai-head">${esc(x.板块)}${x.策略 ? ' · ' + esc(x.策略.slice(0, 40)) : ''}</div><div class="ai-body">${esc(x.计划)}</div></div>`;
        }).join('') + '</div>';
        a += `<div class="empty-note" style="margin-top:6px;">共匹配 ${ogsm.length} 条 OGSM 计划动作；OGSM 复盘时，抓取数据将取自本部分。</div>`;
    } else {
        a += '<div class="empty-note">无（本月 OGSM 计划中暂无本商品品类/店铺相关的运营动作）。</div>';
    }
    const aEl = document.getElementById('sku-modal-actions'); if (aEl) aEl.innerHTML = a;

    // —— ② 建议 ——
    let sHtml = '<h4>建议 <span class="pill">规则引擎</span></h4>';
    sHtml += `<div class="suggest-summary">${sug.summary}</div>`;
    sHtml += '<div class="suggest-list">' + sug.bullets.map(function (b) {
        return `<div class="suggest-item">${esc(b.t)}</div>`;
    }).join('') + '</div>';
    const sEl = document.getElementById('sku-modal-suggest'); if (sEl) sEl.innerHTML = sHtml;

    // —— ③ 相关联产品 ——
    let rHtml = '<h4>相关联产品情况 <span class="pill">同类目·同客单价·卖点相似</span></h4>';
    if (rel.items.length) {
        rHtml += `<div class="section-hint">对照同类目 ${rel.items.length} 个关联品：本商品转化率/销售额/UV 高于或低于关联品（见标签）。</div>`;
        rHtml += '<table class="rel-table"><thead><tr><th>关联品</th><th>转化率</th><th>销售额</th><th>UV</th><th>客单价</th><th>对比（本 vs 关联）</th><th>关联原因</th></tr></thead><tbody>';
        rel.items.forEach(function (it) {
            rHtml += `<tr><td><div class="rel-name">${esc(it.name || it.sku)}</div><div style="font-size:11px;color:var(--radium-text-muted);">${esc(it.sku)}</div></td>` +
                `<td>${pct(it.conv)}</td><td>${money(it.sales)}</td><td>${it.uv != null ? num(it.uv) : '—'}</td><td>${money(it.avg_price)}</td>` +
                `<td class="cmp-cell">转化${cmpTag(it.cmpConv)}销售${cmpTag(it.cmpSales)}UV${it.uv != null ? cmpTag(it.cmpUv) : ''}</td>` +
                `<td class="rel-reason">${(it.reasons || []).map(function (r) { return '<span class="rel-reason-tag">' + esc(r) + '</span>'; }).join('')}</td></tr>`;
        });
        rHtml += '</tbody></table>';
        if (rel.catAvg) {
            const fc = ctx.current;
            rHtml += `<div class="empty-note" style="margin-top:8px;">同类目均值：转化率 ${pct(rel.catAvg.conv)} · 销售额 ${money(rel.catAvg.sales)} · UV ${num(rel.catAvg.uv)} · 客单价 ${money(rel.catAvg.avg_price)} ｜ ` +
                `本商品转化${cmpTag(cmp(fc.conv, rel.catAvg.conv))}销售${cmpTag(cmp(fc.sales, rel.catAvg.sales))}UV${fc.uv != null ? cmpTag(cmp(fc.uv, rel.catAvg.uv)) : ''}均值</div>`;
        }
    } else {
        rHtml += '<div class="empty-note">无（同类目下暂无其他关联产品可对照）。</div>';
    }
    const rEl = document.getElementById('sku-modal-related'); if (rEl) rEl.innerHTML = rHtml;
}
// 由真实单品构建 ctx
function buildRealCtx(s, rp) {
    return {
        kind: 'real', sku: s.sku, name: s.name, category: s.category, site: rp.site,
        current: s.current, delta: s.delta, previous: s.previous,
        sellingPoints: extractSellingPoints((s.name || '') + ' ' + (s.category || '')),
        realActions: s.real_actions || [],
    };
}
// 由演示单品构建 ctx
function buildDemoCtx(r, code, site) {
    return {
        kind: 'demo', sku: code, name: code, category: r.category, site: site,
        current: { sales: r.actual_sales, avg_price: r.aov, conv: r.conv, uv: null,
                   bounce: null, cart_rate: null, checkout_rate: null, orders: r.actual_orders },
        delta: null, previous: null,
        sellingPoints: extractSellingPoints(r.category || ''),
        realActions: [],
    };
}


/* ===================================================================
 * 重点单品监控（自定义周期 + 目标单量）
 * =================================================================== */
function getFocusConfig() { return JSON.parse(localStorage.getItem('focusConfig') || 'null'); }
function renderProductFocus() {
    const cfg = getFocusConfig();
    const box = document.getElementById('focus-product-list');
    if (!cfg || !cfg.length) {
        box.innerHTML = `<div class="empty-state"><div class="empty-state-icon"></div>
            <div class="empty-state-title">暂无重点单品</div>
            <div class="empty-state-desc">点击"重点单品配置"，搜索并勾选需要监控的 SKU（支持按预估TopN批量选）</div></div>`;
        return;
    }
    const rp = appData.sku_period;
    const start = state.focusCycle.start, end = state.focusCycle.end;
    const cycDays = Math.max(1, (new Date(end) - new Date(start)) / 86400000 + 1);
    let html = `<div class="filter-bar" style="margin-bottom:16px;">
        <div class="filter-group"><span class="filter-label">监控周期(自定义)</span>
            <input type="date" class="filter-select" id="focus-start" value="${start}" onchange="updateFocusCycle()" style="width:auto;"></div>
        <div class="filter-group"><span class="filter-label">至</span>
            <input type="date" class="filter-select" id="focus-end" value="${end}" onchange="updateFocusCycle()" style="width:auto;"></div>
        <span style="font-size:12px;color:var(--radium-text-muted);align-self:center;">共 ${cycDays} 天 · 周期目标 = 月度目标 × (${cycDays}/${A_days()})</span>
        <span style="font-size:12px;color:var(--radium-accent-cyan);align-self:center;margin-left:8px;">· BV美真实单品按「本周期 vs 上周期」对比</span>
    </div><div class="grid-2">`;
    cfg.forEach(item => {
        const realR = rp && rp.skus ? rp.skus[item.code] : null;
        if (realR) html += focusRealCard(realR, rp);
        else html += focusDemoCard(item, cycDays);
    });
    html += '</div>';
    box.innerHTML = html;
}
function focusDemoCard(item, cycDays) {
    const r = (appData.sku_index || {})[item.code + '|' + item.site];
    if (!r) return '';
    const partTarget = Math.round((r.target_orders || 0) * cycDays / A_days());
    const prog = partTarget ? (r.actual_orders / partTarget * 100) : 0;
    const lead = r.actual_orders - partTarget;
    return `<div class="card"><div class="card-header" style="display:flex;justify-content:space-between;">
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
}
function focusRealCard(s, rp) {
    const c = s.current, p = s.previous, dl = s.delta;
    const body = `<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
        <div>类目：${esc(s.category)}</div><div><span class="tag tag-cyan">${rp.site}·真实</span></div>
        <div>本周期销售额：<b>${money(c.sales)}</b></div><div>上周期：${p ? money(p.sales) : '—'}</div>
        <div>销售额变化：${deltaTag(dl.sales)}</div><div>本周期单量：<b>${num(c.orders)}</b></div>
        <div>转化率：${pct(c.conv)} ${deltaTag(dl.conv)}</div><div>加购率：${pct(c.cart_rate)} ${deltaTag(dl.cart_rate)}</div>
        <div>访问次数：${num(c.visits)} ${deltaTag(dl.visits)}</div><div>结账成功率：${pct(c.checkout_rate)} ${deltaTag(dl.checkout_rate)}</div>
    </div>
    <div style="margin-top:10px;text-align:right;"><button class="btn btn-mini" onclick="openSkuModal('${esc(s.sku)}','${rp.site}')">深度</button></div>`;
    return `<div class="card"><div class="card-header" style="display:flex;justify-content:space-between;">
        <div class="card-title" title="${esc(s.name)}">${esc(s.sku)}</div><span class="tag tag-cyan">${rp.site}</span></div>
        <div class="card-body">${body}</div></div>`;
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
function focusPool() {
    const demo = (appData.sku_master || []).map(r => ({ code: r.ns_code, site: r.site, category: r.category, layer: r.layer, target: r.target_orders, actual: r.actual_orders }));
    const rp = appData.sku_period;
    const real = rp ? Object.values(rp.skus).map(s => ({ code: s.sku, site: rp.site, category: s.category, layer: '真实', target: 0, actual: s.current ? s.current.orders : 0 })) : [];
    return demo.concat(real);
}
function renderFocusConfigList() {
    const q = (document.getElementById('focus-search').value || '').trim().toLowerCase();
    const cfg = getFocusConfig() || [];
    const list = focusPool().filter(r => !q || (r.code + r.site + r.category).toLowerCase().includes(q));
    list.sort((a, b) => b.actual - a.actual);
    const sel = new Set(cfg.map(c => c.code + '|' + c.site));
    let rows = '';
    list.slice(0, 160).forEach(r => {
        const checked = sel.has(r.code + '|' + r.site) ? 'checked' : '';
        const tag = r.layer === '真实' ? ' <span class="tag tag-cyan">真实</span>' : '';
        rows += `<tr><td><input type="checkbox" data-code="${esc(r.code)}" data-site="${esc(r.site)}" ${checked}></td>
            <td>${esc(r.code)}</td><td>${r.site}</td><td>${esc(r.category)}</td><td>${esc(r.layer)}${tag}</td>
            <td class="num">${num(r.target)}</td><td class="num">${num(r.actual)}</td></tr>`;
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
        // 兼容旧版 fields 数组：自动展开到 section 顶层
        if (Array.isArray(s.fields) && s.fields.length) {
            const get = k => (s.fields.find(f => f.key === k) || {}).formula || '';
            s.objective = s.objective || get('objective') || '目的';
            s.goal = s.goal || get('goal') || '目标';
            s.strategy = s.strategy || get('strategy') || '策略';
            s.measurement = s.measurement || get('measurement') || '衡量';
            s.plan = s.plan || get('plan') || '计划';
            s.shop = s.shop || '全部';
            s.owner = s.owner || '未分配';
        }
        if (!s.measure_type) s.measure_type = 'manual';
        if (!s.measure_key) s.measure_key = '';
        if (s.target_value == null) s.target_value = 0;
        if (!Array.isArray(s.metrics)) s.metrics = [];
    });
    return cfg;
}
function defaultOgsmConfig() {
    return { sections: [
        { id: 'd1', name: '全站销售达成', shop: '全部', owner: '刘玉辉',
          objective: '完成月度销售目标', goal: '月度销售额达成', strategy: '分站点/类目运营提效',
          measurement: '销售额', plan: '月度目标',
          measure_type: 'total_sales', measure_key: '', target_value: 0, actual_value: null,
          fields: [
            { key: 'objective', label: '目的 Objective', formula: '完成月度销售目标' },
            { key: 'goal', label: '目标 Goal', formula: '月度销售额达成' },
            { key: 'strategy', label: '策略 Strategy', formula: '分站点/类目运营提效' },
            { key: 'measurement', label: '衡量 Measure', formula: '销售额' },
            { key: 'plan', label: '计划 Action', formula: '月度目标' }
          ] },
        { id: 'd2', name: '自营产品线', shop: 'AC美', owner: '刘锦霞',
          objective: '提升飞机杯类目转化能力', goal: '转化率提升至3.5%', strategy: '优化主图视频+详情页',
          measurement: '转化率', plan: '6月完成30款优化',
          measure_type: 'category_sales', measure_key: '飞机杯', target_value: 0, actual_value: null,
          fields: [
            { key: 'objective', label: '目的 Objective', formula: '提升飞机杯类目转化能力' },
            { key: 'goal', label: '目标 Goal', formula: '转化率提升至3.5%' },
            { key: 'strategy', label: '策略 Strategy', formula: '优化主图视频+详情页' },
            { key: 'measurement', label: '衡量 Measure', formula: '转化率' },
            { key: 'plan', label: '计划 Action', formula: '6月完成30款优化' }
          ] },
        { id: 'd3', name: '用户需求导向转型', shop: 'BV美', owner: '刘玉辉',
          objective: '延长产品生命周期', goal: '老品复购率提升5%', strategy: '会员体系+售后回访',
          measurement: '复购率', plan: '6月搭建会员体系',
          measure_type: 'site_sales', measure_key: 'BV美', target_value: 0, actual_value: null,
          fields: [
            { key: 'objective', label: '目的 Objective', formula: '延长产品生命周期' },
            { key: 'goal', label: '目标 Goal', formula: '老品复购率提升5%' },
            { key: 'strategy', label: '策略 Strategy', formula: '会员体系+售后回访' },
            { key: 'measurement', label: '衡量 Measure', formula: '复购率' },
            { key: 'plan', label: '计划 Action', formula: '6月搭建会员体系' }
          ] },
        { id: 'd4', name: '增长策略（新品）', shop: 'UK英', owner: '邓佳',
          objective: '提升新品打造成功率', goal: '新品成功率达60%', strategy: '数据驱动选品+精准推广',
          measurement: '新品成功率', plan: '6月测试5款新品',
          measure_type: 'manual', measure_key: '', target_value: 5, actual_value: 4,
          fields: [
            { key: 'objective', label: '目的 Objective', formula: '提升新品打造成功率' },
            { key: 'goal', label: '目标 Goal', formula: '新品成功率达60%' },
            { key: 'strategy', label: '策略 Strategy', formula: '数据驱动选品+精准推广' },
            { key: 'measurement', label: '衡量 Measure', formula: '新品成功率' },
            { key: 'plan', label: '计划 Action', formula: '6月测试5款新品' }
          ] }
    ] };
}
function openOgsmConfig() {
    document.getElementById('ogsm-config-modal').style.display = 'flex';
    document.getElementById('ogsm-config-note').textContent = '每月板块/指标可变：编辑后保存即生效；周复盘只填「完成字段D」与「检查字段」。';
    const ed = document.getElementById('ogsm-config-editor'); ed.innerHTML = '';
    appData.ogsm_config.sections.forEach((sec, i) => {
        const div = document.createElement('div'); div.style.cssText = 'border:1px solid var(--radium-border);border-radius:12px;padding:14px;margin-bottom:14px;';
        div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <input class="filter-select" style="font-weight:600;max-width:260px;" value="${esc(sec.name)}" onchange="ogsmSetSec(${i},'name',this.value)">
            <button class="btn btn-mini" onclick="ogsmDelSec(${i})">删除板块</button></div>
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px;">
                <input class="filter-select" value="${esc(sec.shop)}" onchange="ogsmSetSec(${i},'shop',this.value)" placeholder="店铺">
                <input class="filter-select" value="${esc(sec.owner)}" onchange="ogsmSetSec(${i},'owner',this.value)" placeholder="责任人">
                <select class="filter-select" onchange="ogsmSetSec(${i},'measure_type',this.value)">
                    <option value="total_sales" ${sec.measure_type==='total_sales'?'selected':''}>total_sales</option>
                    <option value="site_sales" ${sec.measure_type==='site_sales'?'selected':''}>site_sales</option>
                    <option value="category_sales" ${sec.measure_type==='category_sales'?'selected':''}>category_sales</option>
                    <option value="manual" ${sec.measure_type==='manual'?'selected':''}>manual</option>
                </select>
            </div>
            <input class="filter-select" value="${esc(sec.objective)}" onchange="ogsmSetSec(${i},'objective',this.value)" placeholder="目的" style="margin-bottom:8px;">
            <input class="filter-select" value="${esc(sec.goal)}" onchange="ogsmSetSec(${i},'goal',this.value)" placeholder="目标" style="margin-bottom:8px;">
            <input class="filter-select" value="${esc(sec.strategy)}" onchange="ogsmSetSec(${i},'strategy',this.value)" placeholder="策略" style="margin-bottom:8px;">
            <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px;margin-bottom:8px;">
                <input class="filter-select" value="${esc(sec.measurement)}" onchange="ogsmSetSec(${i},'measurement',this.value)" placeholder="衡量">
                <input class="filter-select" value="${esc(sec.measure_key)}" onchange="ogsmSetSec(${i},'measure_key',this.value)" placeholder="维度键">
                <input class="filter-select" value="${esc(sec.target_value)}" onchange="ogsmSetSec(${i},'target_value',this.value)" placeholder="目标值">
            </div>
            <input class="filter-select" value="${esc(sec.plan)}" onchange="ogsmSetSec(${i},'plan',this.value)" placeholder="计划">`;
        ed.appendChild(div);
    });
}
function ogsmSetSec(i, k, v) { appData.ogsm_config.sections[i][k] = v; }
function addOgsmSection() { appData.ogsm_config.sections.push({ id: 'new_' + Date.now(), name: '新板块', shop: '全部', owner: '未分配', objective: '目的', goal: '目标', strategy: '策略', measurement: '衡量', plan: '计划', measure_type: 'manual', measure_key: '', target_value: 0, actual_value: null, fields: [] }); openOgsmConfig(); }
function ogsmDelSec(i) { appData.ogsm_config.sections.splice(i, 1); openOgsmConfig(); }
function saveOgsmConfig() { localStorage.setItem('ogsmConfig', JSON.stringify(appData.ogsm_config)); alert('OGSM 配置已保存'); }
function exportOgsmConfig() { download('ogsm_config.json', JSON.stringify(appData.ogsm_config, null, 2)); }
function importOgsmConfig() { document.getElementById('ogsm-import-box').style.display = 'block'; }
function applyOgsmImport() { try { appData.ogsm_config = JSON.parse(document.getElementById('ogsm-import-text').value); normalizeOgsm(appData.ogsm_config); openOgsmConfig(); renderWeeklyReview(); } catch (e) { alert('JSON 解析失败'); } }
function closeOgsmConfig() { document.getElementById('ogsm-config-modal').style.display = 'none'; }

function fmtOgsmValue(v, unit) {
    if (unit === 'money') return fmtW(v);
    if (unit === 'percent') return pct(v);
    return num(v);
}
function computeOgsmData(sec) {
    const a = A;
    const type = sec.measure_type || 'manual';
    const key = sec.measure_key || '';
    let actual = 0, target = 0, unit = 'money';
    if (type === 'total_sales') {
        actual = a.total.sales || 0;
        target = sec.target_value || a.total.target_sales || 0;
    } else if (type === 'total_orders') {
        actual = a.total.orders || 0;
        target = sec.target_value || a.total.target_orders || 0; unit = 'number';
    } else if (type === 'site_sales') {
        const d = a.by_site[key || sec.shop] || {};
        actual = d.sales || 0; target = sec.target_value || d.target_sales || 0;
    } else if (type === 'site_orders') {
        const d = a.by_site[key || sec.shop] || {};
        actual = d.orders || 0; target = sec.target_value || 0; unit = 'number';
    } else if (type === 'category_sales') {
        const d = a.by_category[key] || {};
        actual = d.sales || 0; target = sec.target_value || d.target_sales || 0;
    } else if (type === 'category_orders') {
        const d = a.by_category[key] || {};
        actual = d.orders || 0; target = sec.target_value || d.target_orders || 0; unit = 'number';
    } else if (type === 'layer_orders') {
        const d = a.by_layer[key] || {};
        actual = d.orders || 0; target = sec.target_value || d.target_orders || 0; unit = 'number';
    } else if (type === 'channel_sales') {
        const site = a.by_site[sec.shop] || {};
        const ch = (site.channels || {})[key] || {};
        actual = ch.sales || 0; target = sec.target_value || 0;
    } else {
        actual = sec.actual_value || 0; target = sec.target_value || 0; unit = 'number';
    }
    const progress = target ? actual / target * 100 : 0;
    const tp = state.timeProgress;
    const expected = target * tp / 100;
    const gap = actual - expected;
    const gapPct = progress - tp;
    const status = gapPct >= 0 ? '超前' : '滞后';
    return { actual, target, progress, gap, gapPct, status, unit, type, key };
}
function buildOgsmCheck(sec, data) {
    const tp = state.timeProgress;
    if (data.progress >= 100 || data.gapPct >= 0) {
        return '整体进度达标/超前，按当前节奏推进即可。';
    }
    const a = A;
    let parts = [];
    if (data.type === 'total_sales') {
        const lagging = SITES.map(s => ({ s, d: a.by_site[s] })).filter(x => x.d.gap < 0).sort((a, b) => a.d.gap - b.d.gap);
        if (lagging.length) parts.push(`按站点拆解：${lagging.map(x => `${x.s}(${fmtW(x.d.sales)}/${fmtW(x.d.target_sales)})`).join('、')} 低于时间进度。`);
        const catLag = CATS.map(c => ({ c, d: a.by_category[c] })).filter(x => x.d.gap < 0).sort((a, b) => a.d.gap - b.d.gap);
        if (catLag.length) parts.push(`按类目拆解：${catLag.map(x => `${x.c}进度${pct(x.d.target_progress)}`).join('、')} 为主要缺口。`);
    } else if (data.type === 'site_sales') {
        const site = data.key || sec.shop;
        const d = a.by_site[site] || {};
        const total = d.sales || 1;
        const chParts = CHANNELS.map(ch => {
            const v = (d.channels || {})[ch] || {};
            return `${ch}${fmtW(v.sales || 0)}(${(v.sales / total * 100).toFixed(1)}%)`;
        }).join('、');
        parts.push(`按渠道拆解：${chParts}；占比偏低渠道需优化素材与出价。`);
        const catParts = CATS.map(c => ({ c, v: (d.categories || {})[c] || {} })).filter(x => x.v.sales).map(x => `${x.c}${fmtW(x.v.sales)}`).join('、');
        if (catParts) parts.push(`按类目拆解：${catParts}。`);
    } else if (data.type === 'category_sales') {
        const cat = data.key;
        const d = a.by_category[cat] || {};
        const siteParts = SITES.map(s => ({ s, v: (d.by_site || {})[s] || {} })).filter(x => x.v.sales).map(x => `${x.s}${fmtW(x.v.sales)}`).join('、');
        if (siteParts) parts.push(`按站点拆解：${siteParts}。`);
        const layerParts = LAYERS.map(l => ({ l, v: (d.layers || {})[l] || {} })).filter(x => x.v.sales).map(x => `${x.l}${fmtW(x.v.sales)}`).join('、');
        if (layerParts) parts.push(`按分层拆解：${layerParts}；腰部层贡献偏弱需重点拉升。`);
    } else if (data.type === 'manual') {
        return `进度${pct(data.progress)}；按${sec.shop || '全部'}口径持续推进，达成细节需结合${sec.measurement || '衡量指标'}实际完成情况。`;
    }
    if (!parts.length) return '整体进度正常，暂无显著偏差。';
    return parts.join(' ') + ' 建议：聚焦滞后维度，加大投放/优化转化，确保全月目标达成。';
}
function autoFillWeeklyReview() {
    appData.ogsm_config.sections.forEach((sec, i) => {
        const key = sec.id || i;
        const computed = computeOgsmData(sec);
        const dEl = document.getElementById('d_' + key);
        const cEl = document.getElementById('c_' + key);
        if (dEl) dEl.value = `完成${fmtOgsmValue(computed.actual, computed.unit)}，目标${fmtOgsmValue(computed.target, computed.unit)}，进度${pct(computed.progress)}，${computed.status}${Math.abs(computed.gapPct).toFixed(1)}%`;
        if (cEl) cEl.value = buildOgsmCheck(sec, computed);
    });
}
function renderWeeklyReview() {
    const week = document.getElementById('ogsms-week').value;
    const saved = JSON.parse(localStorage.getItem('ogsm_' + state.month + '_' + week) || '{}');
    let html = `<div style="margin-bottom:12px;font-size:13px;color:var(--radium-text-muted);">周期：${week} · 月份：${state.month} · 截止 ${state.cutoff.slice(5)}</div>
        <table class="data-table ogsm-table">
        <thead><tr>
            <th style="min-width:110px;">板块</th>
            <th style="min-width:120px;">目的</th>
            <th style="min-width:100px;">目标</th>
            <th style="min-width:130px;">策略</th>
            <th style="min-width:80px;">衡量</th>
            <th style="min-width:100px;">计划</th>
            <th style="min-width:70px;">店铺</th>
            <th style="min-width:70px;">责任人</th>
            <th style="min-width:200px;">完成D</th>
            <th style="min-width:220px;">检查</th>
        </tr></thead><tbody>`;
    appData.ogsm_config.sections.forEach((sec, i) => {
        const key = sec.id || i;
        const sv = saved[key] || {};
        const computed = computeOgsmData(sec);
        const defaultD = `完成${fmtOgsmValue(computed.actual, computed.unit)}，目标${fmtOgsmValue(computed.target, computed.unit)}，进度${pct(computed.progress)}，${computed.status}${Math.abs(computed.gapPct).toFixed(1)}%`;
        const defaultCheck = buildOgsmCheck(sec, computed);
        const d = sv.D || defaultD;
        const c = sv.check || defaultCheck;
        html += `<tr>
            <td><b>${esc(sec.name)}</b></td>
            <td>${esc(sec.objective)}</td>
            <td>${esc(sec.goal)}</td>
            <td>${esc(sec.strategy)}</td>
            <td>${esc(sec.measurement)}</td>
            <td>${esc(sec.plan)}</td>
            <td>${esc(sec.shop)}</td>
            <td>${esc(sec.owner)}</td>
            <td><textarea class="filter-select" id="d_${key}" style="width:100%;min-height:70px;">${esc(d)}</textarea></td>
            <td><textarea class="filter-select" id="c_${key}" style="width:100%;min-height:70px;">${esc(c)}</textarea></td>
        </tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('ogsms-report').innerHTML = html;
}
function saveWeeklyReview() {
    const week = document.getElementById('ogsms-week').value;
    const out = {};
    appData.ogsm_config.sections.forEach((sec, i) => {
        const key = sec.id || i;
        out[key] = { D: (document.getElementById('d_' + key) || {}).value || '', check: (document.getElementById('c_' + key) || {}).value || '' };
    });
    localStorage.setItem('ogsm_' + state.month + '_' + week, JSON.stringify(out));
    alert('已保存「' + state.month + '月 ' + week + '」填写（覆盖同周）');
}
function copyOGSMContent() {
    const txt = document.getElementById('ogsms-report').innerText;
    navigator.clipboard.writeText(txt).then(() => alert('已复制周复盘内容'));
}
/* ---------- 真实 OGSM（7月，飞机杯）---------- */
function switchOgsmTab(tab) {
    const real = tab === 'real';
    document.getElementById('ogsm-tab-real').classList.toggle('active', real);
    document.getElementById('ogsm-tab-gen').classList.toggle('active', !real);
    document.getElementById('ogsms-real-wrap').style.display = real ? '' : 'none';
    document.getElementById('ogsms-gen-wrap').style.display = real ? 'none' : '';
    if (real) renderOgsmReal();
    else renderWeeklyReview();
}
function ogsmStatusTag(s) {
    const m = { '滞后': 'red', '超前': 'green', '正常': 'cyan', '未开始': 'yellow' };
    return `<span class="tag tag-${m[s] || 'yellow'}">${esc(s || '—')}</span>`;
}
function renderOgsmReal() {
    const o = appData.ogsm_july;
    const box = document.getElementById('ogsms-real');
    if (!o || !o.rows || !o.rows.length) {
        box.innerHTML = '<div class="empty-state"><div class="empty-state-icon"></div><div class="empty-state-title">暂无真实OGSM数据</div><div class="empty-state-desc">需将「商品部 26年-7月OGSM」CSV 放入 data/ 目录后重新生成</div></div>';
        return;
    }
    const meta = document.getElementById('ogsms-real-meta');
    if (meta) meta.textContent = (o.meta.source || '') + ' ｜ 周次：' + (o.meta.weeks || []).join(' / ');
    let html = `<table class="data-table ogsm-table"><thead><tr>
        <th style="min-width:84px;">板块</th><th style="min-width:110px;">目的</th>
        <th style="min-width:160px;">目标</th><th style="min-width:150px;">策略</th>
        <th style="min-width:130px;">衡量</th><th style="min-width:150px;">计划</th>
        <th style="min-width:84px;">店铺</th><th style="min-width:70px;">责任人</th>
        <th style="min-width:230px;">完成情况D</th><th style="min-width:70px;">状态</th>
        <th style="min-width:230px;">检查C</th><th style="min-width:200px;">下一步计划</th>
    </tr></thead><tbody>`;
    o.rows.forEach(r => {
        const w = r.weeks[0] || {};
        html += `<tr>
            <td><b>${esc(r['板块'])}</b></td>
            <td style="white-space:pre-wrap;">${esc(r['目的'])}</td>
            <td style="white-space:pre-wrap;">${esc(r['目标'])}</td>
            <td style="white-space:pre-wrap;">${esc(r['策略'])}</td>
            <td style="white-space:pre-wrap;">${esc(r['衡量'])}</td>
            <td style="white-space:pre-wrap;">${esc(r['计划'])}</td>
            <td>${esc(r['落地店铺'])}</td>
            <td>${esc(r['责任人'])}</td>
            <td style="white-space:pre-wrap;">${esc(w.D)}</td>
            <td>${ogsmStatusTag(w.status)}</td>
            <td style="white-space:pre-wrap;">${esc(w.check)}</td>
            <td style="white-space:pre-wrap;">${esc(w.next)}</td>
        </tr>`;
    });
    html += `</tbody></table>`;
    box.innerHTML = html;
}
function copyOgsmReal() {
    const txt = document.getElementById('ogsms-real').innerText;
    navigator.clipboard.writeText(txt).then(() => alert('已复制真实OGSM内容'));
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
    if (!ranked.length) { box.innerHTML = `<div class="empty-state"><div class="empty-state-icon"></div><div class="empty-state-title">未匹配到强相关策略</div><div class="empty-state-desc">可调整目的/想法，或在策略库中补充相关策略</div></div>`; return; }
    box.innerHTML = ranked.map((x, i) => `<div class="card" style="margin-bottom:12px;">
        <div class="card-header" style="display:flex;justify-content:space-between;">
            <div class="card-title">${i + 1}. ${esc(x.s.name)}</div>
            <span class="tag tag-${x.s.effect === '有效' ? 'green' : x.s.effect === '部分有效' ? 'cyan' : 'red'}">${x.s.effect}</span></div>
        <div class="card-body" style="font-size:13px;line-height:1.7;">
            <div>成功率评定：<b>${x.score}</b>/100 ｜ 优先级 ${esc(x.s.priority)}</div>
            <div>关键事项：${(x.s.keyPoints || []).map(k => '·' + esc(k)).join(' ') || '—'}</div>
            <div>为什么用这个策略：${esc(x.s.why)}</div>
            <div>如何写成OGSM：${esc(x.s.ogsm)}</div>
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
function openStrategyModal() { document.getElementById('strategy-modal').style.display = 'flex'; document.getElementById('strategy-modal-title').textContent = '添加策略'; }
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
