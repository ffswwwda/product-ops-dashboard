# -*- coding: utf-8 -*-
"""
商品运营看板 - 数据生成脚本 v2.1
原则：
  1. 每个业绩数字都对应一个目标金额 + 截止日期实际额 -> 目标进度/时间进度/超前滞后
  2. 所有聚合(站点/类目/分层/渠道)由 SKU 级一致推导
  3. SKU 实际额整体缩放对齐 xlsx 官方站点目标(×时间进度)，保证进度合理
  4. 单品下钻键 = ns_code|site；点击分层/单品可展开
  5. 类目/站点 环比(按全月节奏) = 本月预计全月 vs 上月全月实际
运行：python3 scripts/build_data.py
"""
import json, os, datetime
from collections import defaultdict

random = None
SEED = 20260714

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_XLSX = '/Users/fsw/Downloads/6月目标与规则 (1).xlsx'
OUT = os.path.join(ROOT, 'js', 'data', 'data.json')

SITES = ['AC美', 'BV美', 'UK英', 'EU欧']
CATS = ['飞机杯', '增大器', '龟头训练器']
LAYERS = ['超爆', '爆款', '头部', '腰部', '尾部']
# 渠道：BV美真实渠道体系（来源：6月1日-6月20日 BV美器具组渠道销量）
# SEM / EMAIL / 直访 / SEO / 信息流 / 联盟 / 社媒 / 其他
CHANNELS = ['SEM', 'EMAIL', '直访', 'SEO', '信息流', '联盟', '社媒', '其他']

# BV美采用真实渠道占比（来自渠道销量表合计行：SEM 984 / EMAIL 185 / 直访 129 /
# SEO 48 / 信息流 43 / 联盟 23 / 社媒 11 / 其他 2，合计 1425 单）；其余站点为演示占比。
CH_SHARE = {
    'AC美': {'SEM': .55, 'EMAIL': .10, '直访': .12, 'SEO': .06, '信息流': .07, '联盟': .05, '社媒': .04, '其他': .01},
    'BV美': {'SEM': .6905, 'EMAIL': .1298, '直访': .0905, 'SEO': .0337, '信息流': .0302, '联盟': .0161, '社媒': .0077, '其他': .0015},
    'UK英': {'SEM': .50, 'EMAIL': .08, '直访': .10, 'SEO': .08, '信息流': .09, '联盟': .10, '社媒': .04, '其他': .01},
    'EU欧': {'SEM': .52, 'EMAIL': .09, '直访': .11, 'SEO': .07, '信息流': .07, '联盟': .08, '社媒': .05, '其他': .01},
}
AOV = {'飞机杯': 72, '增大器': 118, '龟头训练器': 58}
CONV = {'超爆': .185, '爆款': .150, '头部': .115, '腰部': .085, '尾部': .055}

MONTHS = ['5月', '6月', '7月']
TP = {'5月': 100.0, '6月': 100.0, '7月': 45.2}
CUTOFF = {'5月': '2026-05-31', '6月': '2026-06-30', '7月': '2026-07-14'}
DAYSPM = {'5月': 31, '6月': 30, '7月': 31}
ELAPSED = {'5月': 31, '6月': 30, '7月': 14}
CUR = '7月'


def load_real_targets():
    try:
        import openpyxl
        wb = openpyxl.load_workbook(SRC_XLSX, data_only=True)
        ws = wb['销售额目标']
        t = defaultdict(lambda: defaultdict(float))
        for r in range(2, ws.max_row + 1):
            m, site, val = ws.cell(r, 1).value, ws.cell(r, 2).value, ws.cell(r, 5).value
            if m and site and isinstance(val, (int, float)):
                t[str(m) + '月'][site] += float(val)
        return t
    except Exception as e:
        print('xlsx读取失败:', e)
        return {}

real = load_real_targets()
TARGETS = {}
for m in MONTHS:
    TARGETS[m] = {}
    for s in SITES:
        if m in real and s in real[m]:
            TARGETS[m][s] = {'sales_target': round(real[m][s]), 'group': '器具组',
                              'category': '飞机杯,增大器', 'is_demo_target': False}
        else:
            base = real.get('6月', {}).get(s, 800000)
            TARGETS[m][s] = {'sales_target': round(base * 1.25), 'group': '器具组',
                              'category': '飞机杯,增大器', 'is_demo_target': True}

prev = json.load(open(OUT)) if os.path.exists(OUT) else {}
SKU_TARGETS = prev.get('sku_targets') or []
SKU_ACTUALS = prev.get('sku_actuals') or {}
if not SKU_TARGETS:
    SKU_TARGETS = [{'ns_code': 'X', 'category': '飞机杯', 'last_month_sales': 100,
                    'position': '腰部', 'owner': '刘玉辉', 'month_estimate': 120,
                    'estimate_position': '头部', 'change_type': '增量', 'remark': '', 'site': 'AC美'}]

def dflt(v, d):
    return v if v not in (None, '', 'None') else d

def assign_channel(site, code):
    shares = CH_SHARE[site]
    r = (abs(hash(code)) % 1000) / 1000.0
    acc = 0.0
    for ch, sh in shares.items():
        acc += sh
        if r <= acc:
            return ch
    return list(shares.keys())[-1]

def noise(code, salt):
    return 0.85 + (abs(hash(code + salt)) % 300) / 1000.0  # 0.85~1.15

def build_sku_month(sku, month, scale=1.0):
    """返回该 SKU 在 month 的明细(已缩放)"""
    code = dflt(sku.get('ns_code'), 'X')
    site = dflt(sku.get('site'), 'AC美')
    cat = dflt(sku.get('category'), '飞机杯')
    layer = dflt(sku.get('position'), '腰部')
    target = sku.get('month_estimate') or 0
    tp = TP[month] / 100.0
    if month == CUR:
        orders = max(0, round(target * tp * noise(code, month)))
    else:
        orders = max(0, round(target * noise(code, month)))
    orders = max(0, round(orders * scale))
    aov = AOV[cat] * (0.9 + (abs(hash(code + 'aov')) % 200) / 1000.0)
    sales = round(orders * aov)
    conv = CONV.get(layer, .08) * (0.85 + (abs(hash(code + 'c')) % 300) / 1000.0)
    # 渠道拆分：单品订单按站点渠道占比分配到各渠道（多通道，保留浮动值）
    # 聚合时各 SKU 浮动值相加 => 渠道占比精确等于真实占比；仅展示时取整。
    shares = CH_SHARE[site]
    ch_orders = {ch: orders * sh for ch, sh in shares.items()}
    ch_sales = {ch: ch_orders[ch] * aov for ch in ch_orders}
    dominant = max(shares, key=shares.get)
    return {'ns_code': code, 'site': site, 'category': cat, 'layer': layer,
            'est_layer': dflt(sku.get('estimate_position'), layer),
            'owner': dflt(sku.get('owner'), '未分配'),
            'change_type': dflt(sku.get('change_type'), '维稳'),
            'remark': sku.get('remark', '') or '',
            'target_orders': target, 'last_month_sales': sku.get('last_month_sales'),
            'actual_orders': orders, 'actual_sales': sales,
            'aov': round(aov, 1), 'conv': round(conv, 4),
            'channel': dominant,
            'channels': {ch: {'sales': ch_sales[ch], 'orders': ch_orders[ch]} for ch in CHANNELS}}


def fix_channel_integrity(r):
    """修正取整误差：让单品各渠道订单/销售额之和精确等于整数 actual_orders/actual_sales，
    使所有聚合（站点/类目/分层/总计）的渠道合计与总量严格一致。"""
    dom = max(CHANNELS, key=lambda c: r['channels'][c]['orders'])
    tot_o = sum(r['channels'][c]['orders'] for c in CHANNELS)
    r['actual_orders'] = round(tot_o)
    d_o = r['actual_orders'] - tot_o                     # 误差并入占比最大渠道
    r['channels'][dom]['orders'] += d_o
    r['channels'][dom]['sales'] += d_o * r['aov']
    tot_s = sum(r['channels'][c]['sales'] for c in CHANNELS)
    r['actual_sales'] = round(tot_s)
    d_s = r['actual_sales'] - tot_s
    r['channels'][dom]['sales'] += d_s

# 当前月 master(1108) + 缩放对齐目标
sku_master_cur = [build_sku_month(s, CUR, 1.0) for s in SKU_TARGETS]
raw_total = sum(r['actual_sales'] for r in sku_master_cur) or 1
target_total_cur = sum(TARGETS[CUR][s]['sales_target'] for s in SITES)
scale_cur = (target_total_cur * TP[CUR] / 100.0) / raw_total
for r in sku_master_cur:
    for ch in CHANNELS:
        r['channels'][ch]['orders'] *= scale_cur
        r['channels'][ch]['sales'] = r['channels'][ch]['orders'] * r['aov']
    fix_channel_integrity(r)
    # 目标单量同步按同一比例放大，使类目/分层进度与站点一致(demo 月)
    r['target_orders'] = max(0, round(r['target_orders'] * scale_cur))

# 历史月 master(缩放对齐各自目标 × 达成率，制造真实环比趋势)
sku_master_hist = {}
for m in MONTHS:
    if m == CUR:
        sku_master_hist[m] = sku_master_cur
        continue
    att = 0.93 + MONTHS.index(m) * 0.02  # 5月0.93, 6月0.95
    master = [build_sku_month(s, m, 1.0) for s in SKU_TARGETS]
    rt = sum(r['actual_sales'] for r in master) or 1
    tt = sum(TARGETS[m][s]['sales_target'] for s in SITES)
    sc = (tt * att) / rt
    for r in master:
        for ch in CHANNELS:
            r['channels'][ch]['orders'] *= sc
            r['channels'][ch]['sales'] = r['channels'][ch]['orders'] * r['aov']
        fix_channel_integrity(r)
    sku_master_hist[m] = master

# sku_index: ns_code|site -> 明细
sku_index = {}
for r in sku_master_cur:
    sku_index[r['ns_code'] + '|' + r['site']] = r

# 周序列(用于下钻图)
def build_series(r):
    code = r['ns_code']
    if code in SKU_ACTUALS and CUR in SKU_ACTUALS[code]:
        base = SKU_ACTUALS[code][CUR].get('series', [])
        if base:
            return [{'date': w['week'], 'qty': w['qty']} for w in base]
    d0 = datetime.date(2026, 4, 28)
    weeks = 11
    per = max(1, r['actual_orders'] // weeks)
    out = []
    for i in range(weeks):
        dd = d0 + datetime.timedelta(days=7 * i)
        q = max(0, per + ((-1) ** i) * (per // 4))
        out.append({'date': dd.isoformat(), 'qty': q})
    return out

for r in sku_master_cur:
    r['series'] = build_series(r)

# ---------- 聚合 ----------
def aggregate(master, month):
    agg = {'by_site': {}, 'by_category': {}, 'by_layer': {}, 'total': {}}
    for s in SITES:
        agg['by_site'][s] = {'sales': 0, 'orders': 0,
                             'channels': {c: {'sales': 0, 'orders': 0} for c in CHANNELS},
                             'categories': {c: {'sales': 0, 'orders': 0} for c in CATS},
                             'layers': {l: {'sales': 0, 'orders': 0} for l in LAYERS}}
    for c in CATS:
        agg['by_category'][c] = {'sales': 0, 'orders': 0, 'target_sales': 0, 'target_orders': 0,
                                 'by_site': {s: {'sales': 0, 'orders': 0} for s in SITES},
                                 'layers': {l: {'sales': 0, 'orders': 0} for l in LAYERS},
                                 'channels': {ch: {'sales': 0, 'orders': 0} for ch in CHANNELS}}
    for l in LAYERS:
        agg['by_layer'][l] = {'sales': 0, 'orders': 0, 'conv_sum': 0.0, 'conv_w': 0,
                              'target_orders': 0, 'sku_count': 0,
                              'by_site': {s: {'sales': 0, 'orders': 0} for s in SITES}}
    tot_s = tot_o = 0
    for r in master:
        s, cat, layer = r['site'], r['category'], r['layer']
        sales, orders, conv = r['actual_sales'], r['actual_orders'], r['conv']
        tgt_o = r['target_orders']
        tot_s += sales; tot_o += orders
        bs = agg['by_site'][s]
        bs['sales'] += sales; bs['orders'] += orders
        for ch in CHANNELS:
            bs['channels'][ch]['sales'] += r['channels'][ch]['sales']
            bs['channels'][ch]['orders'] += r['channels'][ch]['orders']
        bs['categories'][cat]['sales'] += sales; bs['categories'][cat]['orders'] += orders
        bs['layers'][layer]['sales'] += sales; bs['layers'][layer]['orders'] += orders
        bc = agg['by_category'][cat]
        bc['sales'] += sales; bc['orders'] += orders; bc['target_orders'] += tgt_o
        bc['by_site'][s]['sales'] += sales; bc['by_site'][s]['orders'] += orders
        bc['layers'][layer]['sales'] += sales; bc['layers'][layer]['orders'] += orders
        for ch in CHANNELS:
            bc['channels'][ch]['sales'] += r['channels'][ch]['sales']
            bc['channels'][ch]['orders'] += r['channels'][ch]['orders']
        bl = agg['by_layer'][layer]
        bl['sales'] += sales; bl['orders'] += orders; bl['target_orders'] += tgt_o
        bl['sku_count'] += 1; bl['conv_sum'] += conv * orders; bl['conv_w'] += orders
        bl['by_site'][s]['sales'] += sales; bl['by_site'][s]['orders'] += orders
    agg['total'] = {'sales': tot_s, 'orders': tot_o,
                    'aov': round(tot_s / tot_o, 1) if tot_o else 0}
    for s in SITES:
        bs = agg['by_site'][s]
        tgt = TARGETS[month][s]['sales_target']
        bs['target_sales'] = tgt
        bs['target_progress'] = round(bs['sales'] / tgt * 100, 1) if tgt else 0
        bs['time_progress'] = TP[month]
        bs['aov'] = round(bs['sales'] / bs['orders'], 1) if bs['orders'] else 0
        bs['gap'] = round(bs['sales'] - tgt * bs['time_progress'] / 100.0)
    for c in CATS:
        bc = agg['by_category'][c]
        bc['target_sales'] = round(bc['target_orders'] * AOV[c])
        bc['target_progress'] = round(bc['sales'] / bc['target_sales'] * 100, 1) if bc['target_sales'] else 0
        bc['time_progress'] = TP[month]
        bc['aov'] = round(bc['sales'] / bc['orders'], 1) if bc['orders'] else 0
        bc['gap'] = round(bc['sales'] - bc['target_sales'] * TP[month] / 100.0)
    for l in LAYERS:
        bl = agg['by_layer'][l]
        bl['conv'] = round(bl['conv_sum'] / bl['conv_w'], 4) if bl['conv_w'] else 0
        bl['target_progress'] = round(bl['orders'] / bl['target_orders'] * 100, 1) if bl['target_orders'] else 0
        bl['aov'] = round(bl['sales'] / bl['orders'], 1) if bl['orders'] else 0
        del bl['conv_sum']; del bl['conv_w']
    return agg

aggs = {m: aggregate(sku_master_hist[m], m) for m in MONTHS}

def mom(cur_a, prev_a, pace=False):
    """环比：本月(按全月节奏 actual÷时间进度) vs 上月全月实际"""
    k = (100.0 / TP[CUR]) if pace else 1.0
    out = {'by_site': {}, 'by_category': {}}
    for s in SITES:
        c = cur_a['by_site'][s]['sales'] * k; p = prev_a['by_site'][s]['sales']
        out['by_site'][s] = round((c - p) / p * 100, 1) if p else 0
    for c in CATS:
        c2 = cur_a['by_category'][c]['sales'] * k; p2 = prev_a['by_category'][c]['sales']
        out['by_category'][c] = round((c2 - p2) / p2 * 100, 1) if p2 else 0
    t = cur_a['total']['sales'] * k; pt = prev_a['total']['sales']
    out['total'] = round((t - pt) / pt * 100, 1) if pt else 0
    return out

mom_map = mom(aggs[CUR], aggs['6月'], pace=True)

# 每个月的环比(按全月节奏) vs 上一月
mom_by_month = {}
for i, m in enumerate(MONTHS):
    if i == 0:
        mom_by_month[m] = {'total': 0, 'by_site': {s: 0 for s in SITES}, 'by_category': {c: 0 for c in CATS}}
    else:
        mom_by_month[m] = mom(aggs[m], aggs[MONTHS[i - 1]], pace=True)

actuals = {}
for m in MONTHS:
    a = aggs[m]
    att = 1.0 if m == CUR else (0.93 + MONTHS.index(m) * 0.02)
    a['total']['target_sales'] = sum(TARGETS[m][s]['sales_target'] for s in SITES)
    a['total']['target_progress'] = round(a['total']['sales'] / a['total']['target_sales'] * 100, 1)
    a['total']['gap'] = round(a['total']['sales'] - a['total']['target_sales'] * TP[m] / 100.0)
    actuals[m] = {'cutoff': CUTOFF[m], 'time_progress': TP[m], 'elapsed_days': ELAPSED[m],
                  'days_in_month': DAYSPM[m], 'is_demo': m == CUR, 'attainment': round(att * 100, 1),
                  'mom': mom_by_month[m],
                  'total': a['total'], 'by_site': a['by_site'],
                  'by_category': a['by_category'], 'by_layer': a['by_layer']}
actuals[CUR]['total']['target_sales'] = target_total_cur
actuals[CUR]['total']['target_progress'] = round(actuals[CUR]['total']['sales'] / target_total_cur * 100, 1)
actuals[CUR]['total']['gap'] = round(actuals[CUR]['total']['sales'] - target_total_cur * TP[CUR] / 100.0)

def build_ogsm_config(month):
    """生成 OGSM 复盘表模板：每行=一个板块，含 目的/目标/策略/衡量/计划/店铺/责任人，
       并携带 measure_type / measure_key / target_value 用于自动计算完成D与检查。"""
    a = aggs[month]
    cat_sales = a['by_category']
    total_target = sum(TARGETS[month][s]['sales_target'] for s in SITES)
    def f(code, label, formula):
        return {'key': code, 'label': label, 'formula': formula}
    def fmt_money(n):
        return f'{n / 10000:.1f}万'
    return {
        'meta': {
            'month': '2026年' + month,
            'editable': True,
            'note': '每月板块/指标可能变化：直接编辑本配置（板块与字段、数据源/公式），周复盘只填写"完成字段D"与"检查字段"。'
        },
        'sections': [
            {
                'id': 's1', 'name': '自营产品线', 'shop': 'AC美', 'owner': '刘锦霞',
                'objective': '提升飞机杯类目销售能力',
                'goal': f'飞机杯销售额达成{fmt_money(cat_sales["飞机杯"]["target_sales"])}',
                'strategy': '优化主图视频+详情页',
                'measurement': '销售额',
                'plan': '6月完成30款优化',
                'measure_type': 'category_sales', 'measure_key': '飞机杯',
                'target_value': round(cat_sales['飞机杯']['target_sales']),
                'actual_value': None,
                'fields': [
                    f('objective', '目的 Objective', '提升飞机杯类目销售能力'),
                    f('goal', '目标 Goal', f'飞机杯销售额达成{fmt_money(cat_sales["飞机杯"]["target_sales"])}'),
                    f('strategy', '策略 Strategy', '优化主图视频+详情页'),
                    f('measurement', '衡量 Measure', '销售额'),
                    f('plan', '计划 Action', '6月完成30款优化')
                ]
            },
            {
                'id': 's2', 'name': '用户需求导向转型', 'shop': 'BV美', 'owner': '刘玉辉',
                'objective': '延长产品生命周期',
                'goal': f'BV美销售额达成{fmt_money(a["by_site"]["BV美"]["target_sales"])}',
                'strategy': '会员体系+售后回访',
                'measurement': '销售额',
                'plan': '6月搭建会员体系',
                'measure_type': 'site_sales', 'measure_key': 'BV美',
                'target_value': round(a['by_site']['BV美']['target_sales']),
                'actual_value': None,
                'fields': [
                    f('objective', '目的 Objective', '延长产品生命周期'),
                    f('goal', '目标 Goal', f'BV美销售额达成{fmt_money(a["by_site"]["BV美"]["target_sales"])}'),
                    f('strategy', '策略 Strategy', '会员体系+售后回访'),
                    f('measurement', '衡量 Measure', '销售额'),
                    f('plan', '计划 Action', '6月搭建会员体系')
                ]
            },
            {
                'id': 's3', 'name': '增长策略（新品）', 'shop': 'UK英', 'owner': '邓佳',
                'objective': '提升新品打造成功率',
                'goal': '新品成功率达60%',
                'strategy': '数据驱动选品+精准推广',
                'measurement': '新品成功率',
                'plan': '6月测试5款新品',
                'measure_type': 'manual', 'measure_key': '',
                'target_value': 5, 'actual_value': 4,
                'fields': [
                    f('objective', '目的 Objective', '提升新品打造成功率'),
                    f('goal', '目标 Goal', '新品成功率达60%'),
                    f('strategy', '策略 Strategy', '数据驱动选品+精准推广'),
                    f('measurement', '衡量 Measure', '新品成功率'),
                    f('plan', '计划 Action', '6月测试5款新品')
                ]
            },
            {
                'id': 's4', 'name': '全站销售达成', 'shop': '全部', 'owner': '刘玉辉',
                'objective': '完成月度销售目标',
                'goal': f'月度销售额达成{fmt_money(total_target)}',
                'strategy': '分站点/类目运营提效',
                'measurement': '销售额',
                'plan': '月度目标',
                'measure_type': 'total_sales', 'measure_key': '',
                'target_value': round(total_target),
                'actual_value': None,
                'fields': [
                    f('objective', '目的 Objective', '完成月度销售目标'),
                    f('goal', '目标 Goal', f'月度销售额达成{fmt_money(total_target)}'),
                    f('strategy', '策略 Strategy', '分站点/类目运营提效'),
                    f('measurement', '衡量 Measure', '销售额'),
                    f('plan', '计划 Action', '月度目标')
                ]
            }
        ]
    }

# ===================================================================
# 单品周期真实数据（BV美：本周期 / 上周期 CSV）
# ===================================================================
import csv as _csv, re as _re

CUR_CSV = '/Users/fsw/Downloads/商品-周期数据监控_本周期数据.csv'
PREV_CSV = '/Users/fsw/Downloads/商品-周期数据监控_上周期数据.csv'
PERIOD_SITE = 'BV美'
PERIOD_CUR_LABEL = '本周期'
PERIOD_PREV_LABEL = '上周期'

# (字段键, 是否比率型：比率型差值用百分点pp，其它用相对%)
FIELD_KEYS = [
    ('sales', False), ('avg_price', False), ('conv', True), ('visits', False),
    ('add_cart', False), ('buy_now', False), ('bundle', False), ('cart_rate', True),
    ('checkout_rate', True), ('orders', False), ('qty', False), ('dwell_sec', False),
    ('uv', False), ('entry_uv', False), ('bounce', True), ('exit_rate', True),
    ('age_days', False),
]

def _dec(s):
    s = (s or '').strip().replace(',', '')
    if s == '' or s is None:
        return 0.0
    try:
        return float(s)
    except Exception:
        return 0.0

def _clean(s):
    s = (s or '')
    # 导出瑕疵：&amp; 或被写成 &amp, 均按 & 解码
    s = _re.sub(r'&amp[;,]?', '&', s)
    s = s.replace('&quot;', '"').replace('&lt;', '<').replace('&gt;', '>')
    return s.strip()

def _dwell(s):
    s = (s or '').strip()
    m = _re.match(r'(\d+):(\d+):(\d+)', s)
    if m:
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
    return int(_dec(s))

def _read_period(path):
    d = {}
    if not os.path.exists(path):
        print('CSV 未找到:', path)
        return d
    with open(path, encoding='utf-8-sig') as f:
        rd = _csv.DictReader(f)
        for row in rd:
            sku = _clean(row.get('货号'))
            if not sku:
                continue
            d[sku] = {
                'id': int(_dec(row.get('ID')) or 0),
                'sku': sku,
                'name': _clean(row.get('商品名称')),
                'category': _clean(row.get('分类')),
                'sales': _dec(row.get('总销售')),
                'avg_price': _dec(row.get('均价')),
                'conv': _dec(row.get('转化率')),
                'visits': int(_dec(row.get('访问次数')) or 0),
                'add_cart': int(_dec(row.get('加入购物车')) or 0),
                'buy_now': int(_dec(row.get('立即购买')) or 0),
                'bundle': int(_dec(row.get('搭配购买')) or 0),
                'cart_rate': _dec(row.get('加购率')),
                'checkout_rate': _dec(row.get('结账成功率')),
                'orders': int(_dec(row.get('总单量')) or 0),
                'qty': int(_dec(row.get('总数量')) or 0),
                'dwell_sec': _dwell(row.get('停留时间(秒)')),
                'uv': int(_dec(row.get('唯一访客')) or 0),
                'entry_uv': int(_dec(row.get('入口UV')) or 0),
                'bounce': _dec(row.get('跳出率')),
                'exit_rate': _dec(row.get('退出率')),
                'age_days': int(_dec(row.get('上架天数')) or 0),
            }
    return d

def _mk_delta(cur, prev):
    out = {}
    for key, is_rate in FIELD_KEYS:
        cv = cur.get(key, 0)
        pv = prev.get(key, 0) if prev else 0
        if is_rate:
            d = cv - pv
            rel = None
        else:
            d = cv - pv
            rel = (cv - pv) / pv * 100 if pv else None
        out[key] = {'cur': cv, 'prev': pv, 'abs': d, 'rel': rel, 'is_rate': is_rate}
    return out

def build_sku_period():
    cur = _read_period(CUR_CSV)
    prev = _read_period(PREV_CSV)
    skus = {}
    matched = 0
    for sku, c in cur.items():
        p = prev.get(sku)
        if p:
            matched += 1
        skus[sku] = {
            'id': c['id'], 'sku': sku, 'name': c['name'], 'category': c['category'],
            'current': c, 'previous': p, 'delta': _mk_delta(c, p),
        }
    # 按分类聚合（用于周期监控概览）
    by_cat = {}
    for s in skus.values():
        cat = s['category'] or '未分类'
        bc = by_cat.setdefault(cat, {'cur': defaultdict(float), 'prev': defaultdict(float), 'count': 0})
        bc['count'] += 1
        for key, _ in FIELD_KEYS:
            bc['cur'][key] += s['current'].get(key, 0)
            if s['previous']:
                bc['prev'][key] += s['previous'].get(key, 0)
    by_cat_out = {}
    for cat, bc in by_cat.items():
        by_cat_out[cat] = {
            'count': bc['count'],
            'current': dict(bc['cur']), 'previous': dict(bc['prev']),
            'delta': _mk_delta(dict(bc['cur']), dict(bc['prev'])),
        }
    print('sku_period:', PERIOD_SITE, '本周期', len(cur), '上周期', len(prev), '匹配', matched)
    return {
        'site': PERIOD_SITE, 'period_current': PERIOD_CUR_LABEL, 'period_prev': PERIOD_PREV_LABEL,
        'sku_count': len(skus), 'matched': matched,
        'skus': skus, 'by_category': by_cat_out,
    }

# ---------- 真实 OGSM（7月，飞机杯）----------
def build_ogsm_july():
    """解析商品部真实 OGSM CSV（data/ogsm_july_raw.csv）为结构化数据。
    表头：板块/目的/目标/策略/衡量/计划/落地店铺/责任人 + 每周块(完成情况D/状态/检查C/下一步计划)。
    板块/目的为空时向上沿用上一行。"""
    import csv as _csv
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'ogsm_july_raw.csv')
    if not os.path.exists(path):
        return None
    rows = list(_csv.reader(open(path, encoding='utf-8-sig', newline='')))
    if len(rows) < 3:
        return None
    header = rows[0]
    # 周块：从 col8 起，每 4 列一个（D/状态/检查/下一步）
    week_labels = []
    c = 8
    while c < len(header) and header[c].strip():
        week_labels.append(header[c].strip())
        c += 4
    out_rows = []
    cur_board = ''
    cur_obj = ''
    for row in rows[2:]:
        if not any(cell.strip() for cell in row[:8]):
            continue
        board = (row[0].strip() or cur_board)
        obj = (row[1].strip() or cur_obj)
        cur_board = board or cur_board
        cur_obj = obj or cur_obj
        weeks = []
        for i, wl in enumerate(week_labels):
            b = 8 + i * 4
            weeks.append({
                'label': wl,
                'D': row[b].strip() if b < len(row) else '',
                'status': row[b + 1].strip() if b + 1 < len(row) else '',
                'check': row[b + 2].strip() if b + 2 < len(row) else '',
                'next': row[b + 3].strip() if b + 3 < len(row) else '',
            })
        out_rows.append({
            '板块': board, '目的': obj,
            '目标': row[2].strip(), '策略': row[3].strip(),
            '衡量': row[4].strip(), '计划': row[5].strip(),
            '落地店铺': row[6].strip(), '责任人': row[7].strip(),
            'weeks': weeks,
        })
    return {'meta': {'month': '2026年7月', 'source': '商品部 26年-7月OGSM - 飞机杯',
                     'weeks': week_labels},
            'rows': out_rows}


out = {
    'month_meta': {'current_month': CUR, 'current_month_label': '2026年' + CUR,
                   'today': CUTOFF[CUR], 'cutoff': CUTOFF[CUR],
                   'days_in_month': DAYSPM[CUR], 'elapsed_days': ELAPSED[CUR], 'time_progress': TP[CUR]},
    'targets': TARGETS, 'actuals': actuals, 'sku_index': sku_index,
    'sku_master': sku_master_cur, 'channels': CHANNELS,
    'dimensions': {'sites': SITES, 'categories': CATS, 'layers': LAYERS},
    'sku_targets': SKU_TARGETS,
    'sku_period': build_sku_period(),
    'key_products': prev.get('key_products', []),
    'ogsm_config': build_ogsm_config(CUR),
    'ogsm_july': build_ogsm_july(),
    'strategies': prev.get('strategies', []), 'records': prev.get('records', []),
    'price_targets': prev.get('price_targets', {}), 'struct_targets': prev.get('struct_targets', {}),
    'stats': prev.get('stats', {}),
}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, 'w'), ensure_ascii=False, indent=0)
print('DONE bytes=', os.path.getsize(OUT))
print('CUR total sales=', actuals[CUR]['total']['sales'], 'target=', target_total_cur,
      'progress=', actuals[CUR]['total']['target_progress'], '% gap=', actuals[CUR]['total']['gap'])
print('by_layer:', {l: (actuals[CUR]['by_layer'][l]['orders'], actuals[CUR]['by_layer'][l]['conv']) for l in LAYERS})
print('mom total=', mom_map['total'], 'by_cat=', mom_map['by_category'])
print('sku_index=', len(sku_index), 'sku_master=', len(sku_master_cur))
