/*
 * Copyright (c) 2019, Kudo, Inc.
 * All rights reserved.
 *
 * Author: Duke Fong <d@d-l.io>
 */

let trans_zh_hk = {
    // index
    'Index': '首頁',
    'Serial': '串口',
    'Refresh': '刷新',
    'Open': '打開',
    'Close': '關閉',
    'Current': '當前',
    
    'Available': '可用',
    
    'Devices': '設備',
    'Set': '設置',
    
    'Scroll end': '滾動到最後',
    'Max Len': '最大長度',
    'Clear': '清除',
    'Prev': '上一個',
    'Next': '下一個',
    
    'Online': '在綫',
    'Offline': '離線',
    'Connecting...': '連接中...',
    'Open Window': '打開頁面',
    
    // ctrl
    'Regs': '寄存器',
    'Read Info': '讀設備信息',
    'Read All': '讀取全部',
    'Write All': '寫入全部',
    
    'Less': '簡潔模式',
    'Read per': '讀取頻率',
    
    'Button Edit': '按鍵編輯',
    'Group': '合併組',
    'Ungroup': '取消組',
    'Enable': '使能',
    'Disable': '禁用',
    'Select All': '選擇全部',
    'Load Default': '加載預設',
    'Update Config File': '更新配置文件',
    
    'Device Info': '設備信息',
    'Depth': '深度',
    'Realtime': '實時',
    'Re-Calc': '更新計算',
    'Channels': '通道',
    'Formulas': '公式',
    'Overlays': '疊加項',
    '// _d[1] is the first channel, _d[0] the x axis, at(-1) its newest sample':
        '// _d[1] 是第一個通道，_d[0] 是 X 軸，at(-1) 取該通道最新的一個點',
    '// indent to carry one formula on to the next line': '// 縮進表示同一條公式續行',
    '// base is a reg name or an address, ofs and len are bytes':
        '// 基址可以是寄存器名或地址，偏移和長度的單位是字節',
    '// commas in fmt cover several values: pid_dbg[0], pid_dbg[1] ...':
        '// 類型帶逗號表示一段裡有多個值：pid_dbg[0]、pid_dbg[1] 各是一個通道',
    'Apply': '應用',
    'Slots': '條目',
    'modified': '已修改',
    'one per line, the first is the x axis': '每行一個，第一行是 X 軸',
    'one per line, "name": expression': '每行一個，格式 "名稱": 表達式',
    
    'Reboot': '重啟',
    'Flash': '燒錄',
    'Enter': '進入',
    'Flash Only': '僅燒錄',
    
    'No Check': '不檢查',
    'Read Back Check': '回讀檢查',
    'Read CRC Check': '讀 CRC 檢查',
    
    'Start': '開始',
    'Stop': '停止',
    'Browse': '瀏覽',
    'Progress': '進度',
    
    'Export': '導出',
    'Import': '導入',
    'Export Data': '導出數據',
    'Import Data': '導入數據',
    'Export CSV': '導出 CSV',
    'Series': '曲線',
    'Range': '範圍',
    'Step': '抽取間隔',
    'Significant digits': '有效位數',
    'Rows': '行數',
    'Columns': '列數',
    'No data': '無數據',
    
    'Serial disconnected': '串口斷開連接',
    'Device thread dead, please re-open': '串口線程已退出，請重新打開',
    '(input differs, close and re-open to apply)': '（輸入框與當前不一致，需關閉後重新打開才生效）',
    'Serial port already opened, please close it first, then open again to apply new settings.': '串口已打開，請先關閉再打開，新設置才會生效。',
    'A page for device address %s is already opened in another window, only one page per device address is allowed.': '設備地址 %s 的頁面已在其他窗口打開中，同一設備地址只能打開一個頁面。',
    'The index page is already opened in another window, only one index page is allowed.': '首頁已在其他窗口打開中，首頁只能打開一個。',
    'Close this window and use the existing one. (If the existing one was just closed, wait a few seconds and reload.)': '請關閉本窗口，使用已打開的窗口。（如果已打開的窗口剛剛關閉，請等幾秒後刷新本頁。）',
    'WebSocket disconnected': 'WebSocket 已斷開',
    'The backend may have exited or the connection was lost, please check the backend log and reload the page.': '後台程序可能已退出或連接已斷開，請檢查後台日誌後刷新頁面。',
    'No reply from backend, please check the backend log and reload the page.': '後台程序無回覆，請檢查後台日誌後刷新頁面。',
    'Reply timeout, please Refresh again. If it persists, check the backend log.': '回覆超時，請再點一次刷新。如果持續超時，請檢查後台日誌。',
    'Backend fault, communication may be broken. Please check the backend log and restart it.': '後台程序出現故障，通訊可能已中斷，請檢查後台日誌並重啟後台程序。',
    'Insufficient registers!': '超出寄存器數量！',
    'Invalid incoming data was ignored. Further errors will not be shown repeatedly.': '收到的數據無法解析，已忽略。後續同類錯誤不會重複提示。',
    
    'Config file error, related functions may not work:': '配置文件有誤，相關功能可能無法使用：',
    'Register list is empty.': '寄存器列表為空。',
    'Register list is out of order, addresses must ascend without overlap: %s': '寄存器列表順序有誤，地址必須遞增且不重疊：%s',
    'Plot list is empty.': '波形列表為空。',
    'Plot mask register not found: %s': '波形使能寄存器不存在：%s',
    'label list is empty.': '曲線列表為空。',
    'data register not found: %s': '數據寄存器不存在：%s',
    'config register not found: %s': '配置寄存器不存在：%s',
    'config register has too few slots: %s': '配置寄存器條目數量不足：%s',
    'a formula line must be "name": expression, got: %s': '公式每行須為 "名稱": 表達式，收到：%s',
    'formula "%s" has no expression': '公式 "%s" 沒有內容',
    'an overlay line must be "name": base, ofs, len, fmt, got: %s':
        '疊加項每行須為 "名稱": 基址, 偏移, 長度, 類型，收到：%s',
    'shared by all plots, "name": base, ofs, len, fmt':
        '所有波形共用，格式 "名稱": 基址, 偏移, 長度, 類型',
    'The config file already matches, nothing to save.': '配置文件已經一致，無需寫入。',
    'Saved to %s, the previous version is kept as a .bak file.':
        '已寫入 %s，原檔案已備份為同名的 .bak 檔案。',
    'Restore the channels of all plots and the overlay list from the config file?':
        '把所有波形的通道和疊加項恢復為配置文件中的預設值？',
    'Saved plot channels no longer fit the config file, the default was restored.':
        '保存的波形通道與配置文件不符，已恢復預設。'
};

export { trans_zh_hk };
