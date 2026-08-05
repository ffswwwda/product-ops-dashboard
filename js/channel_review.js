/* ===================================================================
 * 渠道单量对比复盘（port 自独立报告页，数据驱动，支持逐月更新）
 * 数据：js/data/channel_review_index.json -> js/data/channel_review/<period>.json
 * 顶栏「渠道单量复盘」切换进入；内部 5 个细分子板块。
 * =================================================================== */
'use strict';

let CR = { index: null, data: null, period: null };
let crCharts = [];
let crResizeBound = false;
let crSortKey = 'delta', crSortDir = -1;

function crFetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
        return r.json();
    });
}
function crFmt(n) { return (Math.round(n * 10) / 10).toLocaleString('en-US'); }
function crSign(n) { return (n > 0 ? '+' : '') + (Math.round(n * 10) / 10).toLocaleString('en-US'); }

async function crEnsureData(period) {
    if (!CR.index) CR.index = await crFetchJSON('js/data/channel_review_index.json');
    const p = period || CR.period || CR.index.default || (CR.index.periods || [])[0];
    if (CR.data && CR.period === p) return CR.data;
    CR.data = await crFetchJSON('js/data/channel_review/' + p + '.json');
    CR.period = p;
    return CR.data;
}

/* ---------- 页面骨架（一次性注入，之后只填充） ---------- */
function crSkeleton() {
    return `
<div class="cr-wrap">
  <div class="hero">
    <div class="sub" id="cr-heroSub">渠道单量对比</div>
    <div class="big" id="cr-heroBig"></div>
    <div class="desc" id="cr-heroDesc"></div>
  </div>
  <div class="kpis" id="cr-kpiRow"></div>

  <section id="cr-sec1">
    <div class="sec-head"><span class="idx">01</span><h2>渠道单量整体变化</h2></div>
    <div class="sec-sub" id="cr-chSub"></div>
    <div class="grid-2">
      <div class="chart-card"><h3>各渠道单量：6月 vs 7月</h3><div class="cap" id="cr-chBarCap"></div><div id="cr-chBar" class="chart"></div></div>
      <div class="chart-card"><h3>各渠道环比变化幅度</h3><div class="cap" id="cr-chPctCap"></div><div id="cr-chPct" class="chart"></div></div>
    </div>
    <div class="chart-card" style="margin-top:20px;"><h3>渠道明细与归因</h3>
      <div class="scrollbox"><table><thead><tr><th class="tl">渠道</th><th>6月单量</th><th>7月单量</th><th>变化</th><th>环比</th><th class="tl">诊断</th></tr></thead><tbody id="cr-chTable"></tbody></table></div>
    </div>
  </section>

  <section id="cr-sec2">
    <div class="sec-head"><span class="idx">02</span><h2>类目整体单量变化与原因分析</h2></div>
    <div class="sec-sub" id="cr-catSub"></div>
    <div class="grid-2">
      <div class="chart-card"><h3>类目单量：6月 vs 7月</h3><div class="cap">单位：单</div><div id="cr-catBar" class="chart"></div></div>
      <div class="reason" id="cr-catReasonBox"></div>
    </div>
  </section>

  <section id="cr-sec3">
    <div class="sec-head"><span class="idx">03</span><h2>每个 SKU 各渠道单量变化</h2></div>
    <div class="sec-sub">以「新SKU」指代产品。下表展示每个 SKU 在 6月→7月 的总单量变化，以及各渠道单量的增减（红=减，绿=增）。可按类目/状态筛选、按列排序、搜索。</div>
    <div class="toolbar">
      <select id="cr-fCat"></select>
      <select id="cr-fStatus">
        <option value="all">全部状态</option>
        <option value="both">在售（双月）</option>
        <option value="new">7月新增</option>
        <option value="discontinued">6月停售</option>
      </select>
      <input id="cr-fSearch" placeholder="搜索 新SKU / 商品名称…">
      <span class="hint">共 <b id="cr-rowCount">0</b> 个 SKU · 点击表头排序</span>
    </div>
    <div class="scrollbox"><table id="cr-skuTable"><thead><tr id="cr-skuHead"></tr></thead><tbody id="cr-skuBody"></tbody></table></div>
  </section>

  <section id="cr-sec4">
    <div class="sec-head"><span class="idx">04</span><h2>各渠道「下滑 / 提升」SKU 明细</h2></div>
    <div class="sec-sub">逐渠道拆解：哪些 SKU 在该渠道单量下滑、哪些提升。点击渠道标签切换。下滑/提升均按变化量排序。</div>
    <div class="tabs" id="cr-chTabs"></div>
    <div id="cr-chDetail"></div>
  </section>

  <section id="cr-sec5">
    <div class="sec-head"><span class="idx">05</span><h2>行动建议</h2></div>
    <div class="reco"><ol id="cr-recoList"></ol></div>
  </section>

  <div class="foot">数据来源：渠道明细数据 · 单量=订单数 · 报告由自动化分析生成 · 对比周期 <span id="cr-periodLabel"></span></div>
</div>`;
}

/* ---------- 填充（port 自报告 JS，ID 改 cr- 前缀） ---------- */
function crFill(D) {
    const CL = D.current_label, CPL = D.compare_label, CH = D.channels;
    const hasEcharts = (typeof echarts !== 'undefined');

    // 销毁旧图表
    crCharts.forEach(c => { try { c.dispose(); } catch (e) {} });
    crCharts = [];

    // HERO
    const totJ = D.july_total, totN = D.june_total, dTot = totJ - totN, pTot = dTot / totN * 100;
    document.getElementById('cr-heroSub').textContent = '渠道单量对比 · ' + CL + ' vs ' + CPL;
    document.getElementById('cr-heroBig').innerHTML = crFmt(totJ) + ' <span class="delta">' + crSign(dTot) + ' (' + crSign(pTot) + '%)</span>';
    const both = D.sku_detail.filter(r => r.status === 'both');
    const bothDelta = both.reduce((a, r) => a + r.delta, 0);
    const discN = (D.discontinued_skus || []).length;
    let heroDesc = CL + '总单量 <b>' + crFmt(totJ) + '</b> 单，较 ' + CPL + ' <b>' + crFmt(totN) + '</b> 单环比 <b style="color:var(--cr-red)">' + crSign(dTot) + ' 单（' + crSign(pTot) + '%）</b>。';
    if (dTot < 0) {
        const biggestCh = CH.reduce((a, c) => Math.abs(D.ch_july[c] - D.ch_june[c]) > Math.abs(D.ch_july[a] - D.ch_june[a]) ? c : a, CH[0]);
        heroDesc += '下滑高度集中：' + biggestCh + ' 渠道变化最大（' + crSign(D.ch_july[biggestCh] - D.ch_june[biggestCh]) + ' 单），' + discN + ' 个 SKU 停售是主因';
        if (bothDelta > 0) heroDesc += '，而存量在售品实际净增 ' + crSign(bothDelta) + ' 单';
        heroDesc += '。';
    } else {
        heroDesc += '整体增长，' + CH.filter(c => D.ch_july[c] - D.ch_june[c] > 0).length + ' 个渠道正增长。';
    }
    document.getElementById('cr-heroDesc').innerHTML = heroDesc;

    // KPIs
    const discSum = (D.discontinued_skus || []).reduce((a, r) => a + r.june_total, 0);
    const newSum = (D.new_skus || []).reduce((a, r) => a + r.july_total, 0);
    const kpis = [
        { c: '', lab: CL + '总单量', num: crFmt(totJ), note: CPL + ' ' + crFmt(totN) + ' 单' },
        { c: dTot < 0 ? 'r' : 'g', lab: '总量环比变化', num: crSign(dTot), note: dTot < 0 ? '降幅 ' + crSign(pTot) + '%' : '增幅 ' + crSign(pTot) + '%' },
        { c: 'o', lab: '在售 SKU 数', num: D.n_july_sku + ' / ' + D.n_june_sku, note: '净减少 ' + Math.abs(D.n_june_sku - D.n_july_sku) + ' 个' },
        { c: bothDelta >= 0 ? 'g' : 'r', lab: '存量老品净增', num: crSign(bothDelta), note: '双月在售 ' + both.length + ' 个 SKU' }
    ];
    document.getElementById('cr-kpiRow').innerHTML = kpis.map(k =>
        '<div class="kpi ' + k.c + '"><div class="lab">' + k.lab + '</div><div class="num">' + k.num + '</div><div class="note">' + k.note + '</div></div>'
    ).join('');

    // 渠道 section 副标题
    const posCh = CH.filter(c => D.ch_july[c] - D.ch_june[c] > 0);
    const negCh = CH.filter(c => D.ch_july[c] - D.ch_june[c] < 0);
    let chSub = CH.length + ' 大渠道 ' + CL + ' 对比 ' + CPL + ' 的单量与环比变化。';
    if (posCh.length > 0) chSub += posCh.length > 1 ? posCh.length + ' 个渠道正增长，其中 ' + posCh.join('、') + '。' : '唯一正增长渠道为 ' + posCh[0] + '。';
    if (negCh.length > 0) chSub += '下滑渠道：' + negCh.join('、') + '。';
    document.getElementById('cr-chSub').textContent = chSub;
    document.getElementById('cr-chBarCap').textContent = '单位：单';
    document.getElementById('cr-chPctCap').textContent = '环比 = (7月 − 6月) / 6月';

    // 渠道图
    if (hasEcharts) {
        const chBar = echarts.init(document.getElementById('cr-chBar'), 'light');
        chBar.setOption({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => crFmt(v) + ' 单' },
            legend: { data: [CPL, CL], top: 0, right: 0, textStyle: { color: '#64748B' } },
            grid: { left: 60, right: 20, top: 36, bottom: 30 },
            xAxis: { type: 'value', splitLine: { lineStyle: { color: '#E2E8F0' } }, axisLabel: { color: '#64748B' } },
            yAxis: { type: 'category', data: CH, axisLine: { lineStyle: { color: '#E2E8F0' } }, axisLabel: { color: '#0F172A', fontWeight: 600 } },
            series: [
                { name: CPL, type: 'bar', data: CH.map(c => D.ch_june[c]), barWidth: 11, itemStyle: { borderRadius: [0, 3, 3, 0] } },
                { name: CL, type: 'bar', data: CH.map(c => D.ch_july[c]), barWidth: 11, itemStyle: { borderRadius: [0, 3, 3, 0] } }
            ],
            animationDuration: 800, animationEasing: 'cubicOut'
        });
        crCharts.push(chBar);

        const pctData = CH.map(c => ({
            value: Math.round((D.ch_july[c] - D.ch_june[c]) / D.ch_june[c] * 1000) / 10,
            itemStyle: { color: (D.ch_july[c] - D.ch_june[c]) >= 0 ? '#16A34A' : '#DC2626' }
        }));
        const chPct = echarts.init(document.getElementById('cr-chPct'), 'light');
        chPct.setOption({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => (v > 0 ? '+' : '') + v + '%' },
            grid: { left: 60, right: 30, top: 20, bottom: 30 },
            xAxis: { type: 'value', splitLine: { lineStyle: { color: '#E2E8F0' } }, axisLabel: { color: '#64748B', formatter: '{value}%' } },
            yAxis: { type: 'category', data: CH, axisLine: { lineStyle: { color: '#E2E8F0' } }, axisLabel: { color: '#0F172A', fontWeight: 600 } },
            series: [{
                type: 'bar', data: pctData, barWidth: 18,
                label: { show: true, position: 'right', formatter: p => (p.value > 0 ? '+' : '') + p.value + '%', color: '#475569', fontWeight: 600 },
                itemStyle: { borderRadius: 3 }
            }],
            animationDuration: 800, animationEasing: 'cubicOut'
        });
        crCharts.push(chPct);
    } else {
        document.getElementById('cr-chBar').parentElement.innerHTML = '<div style="padding:24px;color:#64748B;font-size:13px;">（图表库未加载，不影响下方表格数据）</div>';
        document.getElementById('cr-chPct').parentElement.innerHTML = '<div style="padding:24px;color:#64748B;font-size:13px;">（图表库未加载，不影响下方表格数据）</div>';
    }

    // 渠道明细表
    function chDiag(c, dd, pct) {
        if (Math.abs(pct) > 90 && dd < 0) return '渠道投放近乎暂停，需立即排查预算/账户状态';
        if (Math.abs(pct) > 30 && dd < 0) return '显著回落，需排查流量来源与转化链路';
        if (Math.abs(pct) > 15 && dd < 0) return '小幅收缩，关注趋势是否持续恶化';
        if (dd >= 0 && pct > 5) return '正增长渠道，是基本盘压舱石，保障供给';
        if (dd >= 0) return '基本稳定';
        return '轻微下滑，影响有限';
    }
    document.getElementById('cr-chTable').innerHTML = CH.map(c => {
        const n = D.ch_june[c], j = D.ch_july[c], dd = j - n, p = dd / n * 100;
        const cls = dd < 0 ? 'neg' : 'pos';
        return '<tr><td class="tl">' + c + '</td><td>' + crFmt(n) + '</td><td>' + crFmt(j) + '</td>' +
            '<td class="' + cls + '">' + crSign(dd) + '</td><td class="' + cls + '">' + crSign(p) + '%</td>' +
            '<td class="tl" style="color:#64748B;font-size:12.5px;">' + chDiag(c, dd, p) + '</td></tr>';
    }).join('');

    // 类目
    const cats = D.cat_data;
    document.getElementById('cr-catSub').textContent = '按运营分类汇总单量。';
    const catDecline = cats.filter(c => c.delta < 0).sort((a, b) => a.delta - b.delta);
    const catGain = cats.filter(c => c.delta > 0).sort((a, b) => b.delta - a.delta);
    let catSub = '按运营分类汇总单量。';
    if (catDecline.length > 0) catSub += catDecline[0].cat + ' 下滑最大（' + crSign(catDecline[0].pct) + '%），主导整体走势；';
    if (catGain.length > 0) catSub += catGain[0].cat + ' 逆势增长（+' + crFmt(catGain[0].pct) + '%）。';
    document.getElementById('cr-catSub').textContent = catSub;

    if (hasEcharts) {
        const catBar = echarts.init(document.getElementById('cr-catBar'), 'light');
        catBar.setOption({
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => crFmt(v) + ' 单' },
            legend: { data: [CPL, CL], top: 0, right: 0, textStyle: { color: '#64748B' } },
            grid: { left: 60, right: 20, top: 36, bottom: 30 },
            xAxis: { type: 'value', splitLine: { lineStyle: { color: '#E2E8F0' } }, axisLabel: { color: '#64748B' } },
            yAxis: { type: 'category', data: cats.map(c => c.cat), axisLine: { lineStyle: { color: '#E2E8F0' } }, axisLabel: { color: '#0F172A', fontWeight: 600 } },
            series: [
                { name: CPL, type: 'bar', data: cats.map(c => c.june), barWidth: 14, itemStyle: { borderRadius: [0, 3, 3, 0] } },
                { name: CL, type: 'bar', data: cats.map(c => c.july), barWidth: 14, itemStyle: { borderRadius: [0, 3, 3, 0] } }
            ],
            animationDuration: 800, animationEasing: 'cubicOut'
        });
        crCharts.push(catBar);
    } else {
        document.getElementById('cr-catBar').parentElement.innerHTML = '<div style="padding:24px;color:#64748B;font-size:13px;">（图表库未加载，不影响下方表格数据）</div>';
    }

    // 类目原因拆解
    let reasonHtml = '';
    for (const c of cats) {
        if (c.delta < 0) {
            const discInCat = (D.discontinued_skus || []).filter(r => r.cat === c.cat);
            const discQty = discInCat.reduce((a, r) => a + r.june_total, 0);
            const bothInCat = D.sku_detail.filter(r => r.cat === c.cat && r.status === 'both');
            const bothDeltaCat = bothInCat.reduce((a, r) => a + r.delta, 0);
            const topSku = D.sku_detail.filter(r => r.cat === c.cat).sort((a, b) => a.delta - b.delta)[0];
            reasonHtml += '<h4 style="font-size:15px;font-weight:700;margin-bottom:4px;">' + c.cat + ' ' + crSign(c.pct) + '% 的原因拆解</h4><ul>';
            if (topSku && topSku.delta < -20) reasonHtml += '<li><b>头部单品断档：</b>「' + (topSku.name || topSku.sku) + '」' + CPL + ' ' + crFmt(topSku.june_total) + ' 单 → ' + CL + ' ' + crFmt(topSku.july_total) + ' 单（' + crSign(topSku.delta) + ' 单），是' + c.cat + '下滑的首要来源。</li>';
            for (const ch of CH) {
                const chDelta = D.ch_july[ch] - D.ch_june[ch];
                if (chDelta < -10) {
                    reasonHtml += '<li><b>' + ch + ' 渠道变化：</b>' + c.cat + '在' + ch + '渠道由 ' + CPL + ' ' + crFmt(D.ch_june[ch]) + ' 单跌至 ' + CL + ' ' + crFmt(D.ch_july[ch]) + ' 单（' + crSign(chDelta) + ' 单）。</li>';
                    break;
                }
            }
            if (discInCat.length > 0) reasonHtml += '<li><b>产品矩阵收缩：</b>' + c.cat + ' 在售 SKU 由 ' + c.n_june + '→' + c.n_july + '（净减少 ' + Math.abs(c.n_june - c.n_july) + ' 个），' + discInCat.length + ' 个 SKU 停售，合计损失 ' + CPL + ' ' + crFmt(discQty) + ' 单。</li>';
            if (bothDeltaCat >= 0) reasonHtml += '<li><b>存量仍在增长：</b>剔除停售 SKU 后，双月在售' + c.cat + '实际净增 ' + crSign(bothDeltaCat) + ' 单，说明需求未崩，问题集中在可干预因素。</li>';
            reasonHtml += '</ul>';
        } else if (c.delta > 0) {
            reasonHtml += '<h4 style="font-size:15px;font-weight:700;margin-bottom:4px;">' + c.cat + ' +' + crFmt(c.pct) + '% 增长原因</h4><ul>';
            reasonHtml += '<li><b>存量精细化见效：</b>SKU 数量 ' + c.n_june + '→' + c.n_july + '（不变），单 SKU 效率提升，验证「聚焦存量、做深单品」路线可行。</li>';
            reasonHtml += '</ul>';
        }
    }
    document.getElementById('cr-catReasonBox').innerHTML = reasonHtml;

    // SKU 主表
    const statusLabel = { both: '在售', new: '新增', discontinued: '停售' };
    const headCols = [
        { k: 'sku', t: '新SKU', tl: 1 }, { k: 'name', t: '商品名称', tl: 1 }, { k: 'cat', t: '类目', tl: 1 },
        { k: 'june_total', t: CPL }, { k: 'july_total', t: CL }, { k: 'delta', t: '变化' }, { k: 'pct', t: '环比' },
        ...CH.map(c => ({ k: 'ch_' + c, t: c }))
    ];
    document.getElementById('cr-skuHead').innerHTML = headCols.map(h =>
        '<th class="' + (h.tl ? 'tl' : '') + '" data-k="' + h.k + '">' + h.t + '</th>').join('');
    document.querySelectorAll('#cr-skuHead th').forEach(th => {
        th.style.cursor = 'pointer';
        th.onclick = () => { const k = th.dataset.k; if (crSortKey === k) crSortDir *= -1; else { crSortKey = k; crSortDir = -1; } crRenderSku(); };
    });
    function chCell(v) {
        if (v === 0) return '<span class="cell-box b-zero">0</span>';
        return '<span class="cell-box ' + (v > 0 ? 'b-pos' : 'b-neg') + '">' + (v > 0 ? '+' : '') + crFmt(v) + '</span>';
    }
    window.crRenderSku = function () {
        const cat = document.getElementById('cr-fCat').value;
        const st = document.getElementById('cr-fStatus').value;
        const q = document.getElementById('cr-fSearch').value.trim().toLowerCase();
        let rows = D.sku_detail.filter(r => {
            if (cat !== 'all' && r.cat !== cat) return false;
            if (st !== 'all' && r.status !== st) return false;
            if (q && !(r.sku.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q))) return false;
            return true;
        });
        rows.sort((a, b) => {
            let va, vb;
            if (crSortKey.startsWith('ch_')) { const c = crSortKey.slice(3); va = a.ch_delta[c]; vb = b.ch_delta[c]; }
            else { va = a[crSortKey]; vb = b[crSortKey]; }
            if (typeof va === 'string') return crSortDir * va.localeCompare(vb, 'zh');
            return crSortDir * (va - vb);
        });
        document.getElementById('cr-rowCount').textContent = rows.length;
        document.getElementById('cr-skuBody').innerHTML = rows.map(r => {
            const dc = r.delta < 0 ? 'neg' : 'pos';
            const pc = r.pct < 0 ? 'neg' : 'pos';
            return '<tr>' +
                '<td class="tl"><b>' + r.sku + '</b></td>' +
                '<td class="tl" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;">' + (r.name || '') + '</td>' +
                '<td class="tl"><span class="pill ' + r.status + '">' + statusLabel[r.status] + '</span> ' + r.cat + '</td>' +
                '<td>' + crFmt(r.june_total) + '</td>' +
                '<td>' + crFmt(r.july_total) + '</td>' +
                '<td class="' + dc + '">' + crSign(r.delta) + '</td>' +
                '<td class="' + pc + '">' + crSign(r.pct) + '%</td>' +
                CH.map(c => '<td>' + chCell(r.ch_delta[c]) + '</td>').join('') +
                '</tr>';
        }).join('');
    };
    const catSet = [...new Set(D.sku_detail.map(r => r.cat))];
    document.getElementById('cr-fCat').innerHTML = '<option value="all">全部类目</option>' +
        catSet.map(c => '<option value="' + c + '">' + c + '</option>').join('');
    document.getElementById('cr-fCat').onchange = window.crRenderSku;
    document.getElementById('cr-fStatus').onchange = window.crRenderSku;
    document.getElementById('cr-fSearch').oninput = window.crRenderSku;
    window.crRenderSku();

    // 渠道 SKU 明细 tab
    const tabsEl = document.getElementById('cr-chTabs'), detailEl = document.getElementById('cr-chDetail');
    function renderCh(c) {
        const o = D.ch_sku[c];
        let html = '<div class="panel"><h4><span class="dot dot-r"></span>' + c + ' 渠道 · 下滑 SKU 明细（共 ' + o.n_declines + ' 个，合计 ' +
            crSign(o.delta) + ' 单）</h4><div class="scrollbox" style="max-height:360px;">' +
            '<table><thead><tr><th class="tl">新SKU</th><th class="tl">商品名称</th><th class="tl">类目</th>' +
            '<th>' + CPL + '</th><th>' + CL + '</th><th>变化</th></tr></thead><tbody>' +
            o.declines_top.map(r => '<tr><td class="tl"><b>' + r.sku + '</b></td><td class="tl">' + (r.name || '') +
                '</td><td class="tl">' + r.cat + '</td><td>' + crFmt(r.june) + '</td><td>' + crFmt(r.july) +
                '</td><td class="neg">' + crSign(r.delta) + '</td></tr>').join('') +
            '</tbody></table></div></div>';
        if (o.gains_top.length) {
            html += '<div class="panel"><h4><span class="dot dot-g"></span>' + c + ' 渠道 · 提升 SKU 明细（共 ' + o.n_gains + ' 个，合计 +' + crFmt(o.gains_top.reduce((a, r) => a + r.delta, 0)) + ' 单）</h4>' +
                '<div class="scrollbox" style="max-height:360px;"><table><thead><tr><th class="tl">新SKU</th><th class="tl">商品名称</th><th class="tl">类目</th>' +
                '<th>' + CPL + '</th><th>' + CL + '</th><th>变化</th></tr></thead><tbody>' +
                o.gains_top.map(r => '<tr><td class="tl"><b>' + r.sku + '</b></td><td class="tl">' + (r.name || '') +
                    '</td><td class="tl">' + r.cat + '</td><td>' + crFmt(r.june) + '</td><td>' + crFmt(r.july) +
                    '</td><td class="pos">' + crSign(r.delta) + '</td></tr>').join('') +
                '</tbody></table></div></div>';
        }
        detailEl.innerHTML = html;
    }
    tabsEl.innerHTML = '';
    CH.forEach((c, i) => {
        const o = D.ch_sku[c];
        const t = document.createElement('div');
        t.className = 'tab' + (i === 0 ? ' active' : '');
        t.innerHTML = c + ' <span class="td ' + (o.delta < 0 ? 'neg' : 'pos') + '">' + crSign(o.delta) + '</span>';
        t.onclick = () => { document.querySelectorAll('#cr-chTabs .tab').forEach(x => x.classList.remove('active')); t.classList.add('active'); renderCh(c); };
        tabsEl.appendChild(t);
    });
    renderCh(CH[0]);

    // 行动建议
    const recos = [];
    const bigChLoss = CH.filter(c => D.ch_july[c] - D.ch_june[c] < -10).sort((a, b) => (D.ch_july[a] - D.ch_june[a]) - (D.ch_july[b] - D.ch_june[b]));
    if (bigChLoss.length > 0) {
        const c = bigChLoss[0];
        recos.push('<b>立即复盘 ' + c + '：</b>' + c + ' 单量从 ' + crFmt(D.ch_june[c]) + ' 变化至 ' + crFmt(D.ch_july[c]) + '（' + crSign(D.ch_july[c] - D.ch_june[c]) + ' 单），优先排查预算暂停/账户异常/策略调整。');
    }
    const topDecline = D.sku_detail.filter(r => r.delta < -20).sort((a, b) => a.delta - b.delta);
    if (topDecline.length > 0) {
        const s = topDecline[0];
        recos.push('<b>填补头部单品空缺：</b>「' + (s.name || s.sku) + '」' + crSign(s.delta) + ' 单是最大损失。评估补货/重新上架或流量导向替代款。');
    }
    if (posCh.length > 0) {
        recos.push('<b>稳住 ' + posCh.join('/') + ' 基本盘：</b>这些渠道正增长，应保障预算与素材供给，作为整体单量压舱石。');
    }
    const newN = (D.new_skus || []).length;
    if (discN > newN) {
        recos.push('<b>遏制产品矩阵收缩：</b>' + discN + ' 个 SKU 停售仅换回 ' + newN + ' 个新品（+' + crFmt(newSum) + ' vs -' + crFmt(discSum) + '）。对仍有动销潜力的停售品做回归评估，新品上架节奏需更快。');
    }
    if (catGain.length > 0) {
        recos.push('<b>复制 ' + catGain[0].cat + ' 打法：</b>' + catGain[0].cat + ' 在 SKU 数量不变下增长 +' + crFmt(catGain[0].pct) + '%，存量精细化运营有效。将经验迁移至下滑类目中腰部 SKU。');
    }
    const midChLoss = CH.filter(c => D.ch_july[c] - D.ch_june[c] < 0 && c !== bigChLoss[0] && Math.abs(D.ch_july[c] - D.ch_june[c]) > 5);
    if (midChLoss.length > 0) {
        recos.push('<b>修复 ' + midChLoss.join('/') + '：</b>需排查复购链路、触达与内容，避免流量持续流失。');
    }
    document.getElementById('cr-recoList').innerHTML = recos.map(r => '<li>' + r + '</li>').join('');

    document.getElementById('cr-periodLabel').textContent = (D.label || (CL + ' vs ' + CPL));

    if (!crResizeBound) {
        window.addEventListener('resize', () => { crCharts.forEach(c => { try { c.resize(); } catch (e) {} }); });
        crResizeBound = true;
    }
}

/* ---------- 入口：顶栏切换调用 ---------- */
async function renderChannelReview(sub) {
    const cont = document.getElementById('cr-content');
    if (!cont) return;
    // 初始化周期选择器（顶栏页头内，静态存在）
    try { await crInitPeriodSelect(); } catch (e) {}
    // 骨架同步注入（容器先存在，避免闪烁）
    cont.innerHTML = crSkeleton();

    try {
        const D = await crEnsureData(CR.period);
        crFill(D);
        // 顶栏子版块：滚动定位
        const map = { s1: 'cr-sec1', s2: 'cr-sec2', s3: 'cr-sec3', s4: 'cr-sec4', s5: 'cr-sec5' };
        if (sub && map[sub]) {
            const el = document.getElementById(map[sub]);
            if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        }
    } catch (e) {
        cont.innerHTML = '<div class="cr-error">渠道复盘数据加载失败：' + (e && e.message ? e.message : e) +
            '<br>请确认通过本地/线上服务器访问（http(s)://），并已放置 js/data/channel_review/ 数据文件。</div>';
    }
}

/* ---------- 周期选择器（顶栏页头内） ---------- */
async function crInitPeriodSelect() {
    const sel = document.getElementById('cr-period');
    if (!sel) return;
    try {
        const idx = CR.index || await crFetchJSON('js/data/channel_review_index.json');
        CR.index = idx;
        const labels = idx.labels || {};
        sel.innerHTML = (idx.periods || []).map(p =>
            '<option value="' + p + '">' + (labels[p] || p) + '</option>').join('');
        sel.value = CR.period || idx.default || (idx.periods || [])[0];
        sel.onchange = () => { CR.period = sel.value; renderChannelReview('all'); };
    } catch (e) {
        sel.style.display = 'none';
    }
}
