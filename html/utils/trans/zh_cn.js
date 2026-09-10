/*
 * Copyright (c) 2019, Kudo, Inc.
 * All rights reserved.
 *
 * Author: Duke Fong <d@d-l.io>
 */

// cat zh_hk.js | cconv -f UTF8 -t UTF8-CN
let trans_zh_cn = {
    // index
    'Index': '首页',
    'Serial': '串口',
    'Refresh': '刷新',
    'Open': '打开',
    'Close': '关闭',
    'Current': '当前',
    
    'Available': '可用',
    
    'Devices': '设备',
    'Set': '设置',
    
    'Scroll end': '滚动到最后',
    'Max Len': '最大长度',
    'Clear': '清除',
    'Prev': '上一个',
    'Next': '下一个',
    
    'Online': '在线',
    'Offline': '离线',
    'Connecting...': '连接中...',
    'Open Window': '打开页面',
    
    // ctrl
    'Regs': '寄存器',
    'Read Info': '读设备信息',
    'Read All': '读取全部',
    'Write All': '写入全部',
    
    'Less': '简洁模式',
    'Read per': '读取频率',
    
    'Button Edit': '按键编辑',
    'Group': '合并组',
    'Ungroup': '取消组',
    'Enable': '使能',
    'Disable': '禁用',
    'Select All': '选择全部',
    'Load Default': '加载默认',
    
    'Device Info': '设备信息',
    'Depth': '深度',
    'Realtime': '实时',
    'Re-Calc': '更新计算',
    'Channels': '通道',
    'Formulas': '公式',
    'Overlays': '叠加项',
    'Apply': '应用',
    'Slots': '条目',
    'modified': '已修改',
    'one per line, the first is the x axis': '每行一个，第一行是 X 轴',
    'one per line, "name: expression"': '每行一个，格式 "名称: 表达式"',
    
    'Reboot': '重启',
    'Flash': '烧录',
    'Enter': '进入',
    'Flash Only': '仅烧录',
    
    'No Check': '不检查',
    'Read Back Check': '回读检查',
    'Read CRC Check': '读 CRC 检查',
    
    'Start': '开始',
    'Stop': '停止',
    'Browse': '浏览',
    'Progress': '进度',
    
    'Export': '导出',
    'Import': '导入',
    'Export Data': '导出数据',
    'Import Data': '导入数据',
    'Export CSV': '导出 CSV',
    'Series': '曲线',
    'Range': '范围',
    'Step': '抽取间隔',
    'Significant digits': '有效位数',
    'Rows': '行数',
    'Columns': '列数',
    'No data': '无数据',
    
    'Serial disconnected': '串口断开连接',
    'Device thread dead, please re-open': '串口线程已退出，请重新打开',
    '(input differs, close and re-open to apply)': '（输入框与当前不一致，需关闭后重新打开才生效）',
    'Serial port already opened, please close it first, then open again to apply new settings.': '串口已打开，请先关闭再打开，新设置才会生效。',
    'A page for device address %s is already opened in another window, only one page per device address is allowed.': '设备地址 %s 的页面已在其他窗口打开中，同一设备地址只能打开一个页面。',
    'The index page is already opened in another window, only one index page is allowed.': '首页已在其他窗口打开中，首页只能打开一个。',
    'Close this window and use the existing one. (If the existing one was just closed, wait a few seconds and reload.)': '请关闭本窗口，使用已打开的窗口。（如果已打开的窗口刚刚关闭，请等几秒后刷新本页。）',
    'WebSocket disconnected': 'WebSocket 已断开',
    'The backend may have exited or the connection was lost, please check the backend log and reload the page.': '后台程序可能已退出或连接已断开，请检查后台日志后刷新页面。',
    'No reply from backend, please check the backend log and reload the page.': '后台程序无回复，请检查后台日志后刷新页面。',
    'Reply timeout, please Refresh again. If it persists, check the backend log.': '回复超时，请再点一次刷新。如果持续超时，请检查后台日志。',
    'Backend fault, communication may be broken. Please check the backend log and restart it.': '后台程序出现故障，通讯可能已中断，请检查后台日志并重启后台程序。',
    'Insufficient registers!': '超出寄存器数量！',
    'Invalid incoming data was ignored. Further errors will not be shown repeatedly.': '收到的数据无法解析，已忽略。后续同类错误不会重复提示。',
    
    'Config file error, related functions may not work:': '配置文件有误，相关功能可能无法使用：',
    'Register list is empty.': '寄存器列表为空。',
    'Register list is out of order, addresses must ascend without overlap: %s': '寄存器列表顺序有误，地址必须递增且不重叠：%s',
    'Plot list is empty.': '波形列表为空。',
    'Plot mask register not found: %s': '波形使能寄存器不存在：%s',
    'label list is empty.': '曲线列表为空。',
    'data register not found: %s': '数据寄存器不存在：%s',
    'config register not found: %s': '配置寄存器不存在：%s',
    'config register has too few slots: %s': '配置寄存器条目数量不足：%s',
    'a formula line must be "name: expression": %s': '公式每行须为 "名称: 表达式"：%s',
    'an overlay line must be "name: base, ofs, len, fmt": %s':
        '叠加项每行须为 "名称: 基址, 偏移, 长度, 类型"：%s',
    'shared by all plots, "name: base, ofs, len, fmt"':
        '所有波形共用，格式 "名称: 基址, 偏移, 长度, 类型"',
    'Restore the channels of all plots and the overlay list from the config file?':
        '把所有波形的通道和叠加项恢复为配置文件中的默认值？',
    'Saved plot channels no longer fit the config file, the default was restored.':
        '保存的波形通道与配置文件不符，已恢复默认。'
};

export { trans_zh_cn };
