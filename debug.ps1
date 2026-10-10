# ------------------------------------------------------------------------
# 名称：debug.ps1
# 说明：启动 RUJIAN Studio Electron 开发模式。
# 作者：sengbin
# 邮箱：chengbin@3578.cn
# 日期：2026-10-09
# 备注：运行后按 Ctrl+C 停止；文件需保存为带 BOM 的 UTF-8，否则 Windows PowerShell 5.1 会按 ANSI 读取而使中文乱码。
# ------------------------------------------------------------------------

Set-Location -LiteralPath $PSScriptRoot
npm start
