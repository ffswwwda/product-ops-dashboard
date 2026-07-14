import pandas as pd
import json
import os

output_dir = '/Users/fsw/Documents/trae_projects/product-ops-dashboard/js/data'
os.makedirs(output_dir, exist_ok=True)

# 1. 解析策略素材库
print('=== 解析策略素材库 ===')
strategy_df = pd.read_excel('/Users/fsw/Downloads/策略有效性表_运营策略素材库.xlsx', sheet_name='运营策略素材库')
strategy_df = strategy_df.fillna('')

strategies = []
for _, row in strategy_df.iterrows():
    strategies.append({
        'name': str(row['策略名称']),
        'stage': str(row['新品阶段']),
        'price_range': str(row['定价区间']),
        'target': str(row['策略目标']),
        'actions': str(row['策略动作']),
        'type': str(row['策略类型']),
        'priority': str(row['执行优先级']),
        'budget': str(row['预算等级']),
        'cycle': str(row['见效周期']),
        'difficulty': str(row['执行难度']),
        'precondition': str(row['前置条件']),
        'combination': str(row['策略组合']),
        'effect_range': str(row['预期效果范围']),
        'risk': str(row['风险与禁忌']),
        'evaluation': str(row['有效性评估']),
        'effect_data': str(row['效果数据']),
        'shop': str(row['店铺']),
        'category': str(row['品类']),
        'sku': str(row['关联SKU']),
        'scene': str(row['适用场景']),
        'tags': str(row['策略标签']),
        'boundary': str(row['策略边界']),
        'source': str(row['数据来源']),
        'frequency': str(row['出现频次']),
        'remark': str(row['备注']),
        'reason': str(row['原因']),
        'record_time': str(row['记录时间']),
        'recorder': str(row['记录人'])
    })

# 2. 解析策略记录
print('=== 解析策略记录 ===')
record_df = pd.read_csv('/Users/fsw/Downloads/策略有效性表_策略记录.csv')
record_df = record_df.fillna('')

records = []
for _, row in record_df.iterrows():
    records.append({
        'remark': str(row['备注']),
        'strategy_id': str(row['策略ID']),
        'shop': str(row['店铺']),
        'type': str(row['策略类型']),
        'tags': str(row['策略标签']),
        'category': str(row['品类']),
        'sku': str(row['关联SKU']),
        'actions': str(row['策略动作']),
        'scene': str(row['适用场景']),
        'evaluation': str(row['有效性评估']),
        'effect_data': str(row['效果数据']),
        'reason': str(row['原因']),
        'frequency': str(row['策略出现频次']),
        'boundary': str(row['策略边界']),
        'source': str(row['数据来源']),
        'record_time': str(row['记录时间']),
        'recorder': str(row['记录人'])
    })

# 3. 解析目标数据
print('=== 解析目标数据 ===')
target_df = pd.read_excel('/Users/fsw/Downloads/6月目标与规则 (1).xlsx', sheet_name='销售额目标')
target_data = {}
for _, row in target_df.iterrows():
    month = str(row['月份'])
    site = str(row['站点'])
    if month not in target_data:
        target_data[month] = {}
    target_data[month][site] = {
        'sales_target': float(row['本月销售额目标（人民币）']),
        'group': str(row['分组']),
        'category': str(row['运营分类'])
    }

# 4. 解析客单价目标
price_df = pd.read_excel('/Users/fsw/Downloads/6月目标与规则 (1).xlsx', sheet_name='客单价目标')
price_targets = {}
for _, row in price_df.iterrows():
    site = str(row['站点'])
    price_targets[site] = float(row['客单价目标（原币）'])

# 5. 解析类目结构目标
struct_df = pd.read_excel('/Users/fsw/Downloads/6月目标与规则 (1).xlsx', sheet_name='类目结构目标')
struct_targets = {}
for _, row in struct_df.iterrows():
    site = str(row['站点'])
    struct_targets[site] = {
        'super_hot': int(row['超爆']),
        'hot': int(row['爆款']),
        'head': int(row['头部'])
    }

# 6. 解析单品目标（合并所有站点）
sku_targets = []
sites = ['AC美', 'BV美', 'UK英', 'EU欧']
for site in sites:
    sheet_name = f'{site}单品目标'
    try:
        sku_df = pd.read_excel('/Users/fsw/Downloads/6月目标与规则 (1).xlsx', sheet_name=sheet_name)
        sku_df = sku_df.fillna('')
        for _, row in sku_df.iterrows():
            ns_code = str(row['NS货号'])
            if ns_code == 'nan':
                continue
            sku_targets.append({
                'ns_code': ns_code,
                'category': str(row['运营分类']),
                'last_month_sales': int(row['上月销量']) if str(row['上月销量']) != 'nan' else 0,
                'position': str(row['产品定位']),
                'owner': str(row['商品负责人']),
                'month_estimate': int(row['本月预估单量']) if str(row['本月预估单量']) != 'nan' else 0,
                'estimate_position': str(row['预估定位']),
                'change_type': str(row['变化类型']),
                'remark': str(row['备注（单量来源）']),
                'site': site
            })
    except Exception as e:
        print(f'Error reading {sheet_name}: {e}')

# 7. 聚合统计数据
type_stats = {}
for s in strategies:
    t = s['type']
    if t not in type_stats:
        type_stats[t] = 0
    type_stats[t] += 1

evaluation_stats = {}
for s in strategies:
    e = s['evaluation']
    if e not in evaluation_stats:
        evaluation_stats[e] = 0
    evaluation_stats[e] += 1

shop_stats = {}
for s in strategies:
    shop = s['shop']
    if shop not in shop_stats:
        shop_stats[shop] = 0
    shop_stats[shop] += 1

# 生成完整数据
data = {
    'strategies': strategies,
    'records': records,
    'targets': target_data,
    'price_targets': price_targets,
    'struct_targets': struct_targets,
    'sku_targets': sku_targets,
    'stats': {
        'total_strategies': len(strategies),
        'total_records': len(records),
        'total_skus': len(sku_targets),
        'by_type': type_stats,
        'by_evaluation': evaluation_stats,
        'by_shop': shop_stats
    }
}

# 保存JSON
with open(os.path.join(output_dir, 'data.json'), 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f'=== 数据生成完成 ===')
print(f'策略总数: {len(strategies)}')
print(f'记录总数: {len(records)}')
print(f'SKU总数: {len(sku_targets)}')
print(f'策略类型分布: {type_stats}')
print(f'文件已保存到: {output_dir}/data.json')