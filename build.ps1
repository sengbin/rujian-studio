# ------------------------------------------------------------------------
# 名称：build.ps1
# 说明：构建 RUJIAN Studio 桌面应用。
# 作者：sengbin
# 邮箱：chengbin@3578.cn
# 日期：2026-10-10
# 备注：文件需保存为带 BOM 的 UTF-8，否则 Windows PowerShell 5.1 会按 ANSI 读取而使中文乱码。
# ------------------------------------------------------------------------

<#
.SYNOPSIS
安装依赖并构建应用。
.DESCRIPTION
先安装依赖；默认制作安装包，指定 CheckOnly 时只运行类型检查与测试。
.PARAMETER CheckOnly
只执行类型检查与测试，不制作安装包。
.EXAMPLE
.\build.ps1 -CheckOnly
#>
param(
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

Push-Location $PSScriptRoot
try {
    # 原生命令失败不会触发 $ErrorActionPreference，需逐条检查退出代码
    npm install
    if ($LASTEXITCODE -ne 0) {
        throw "依赖安装失败，退出代码：$LASTEXITCODE。"
    }

    if ($CheckOnly) {
        npm run typecheck
        if ($LASTEXITCODE -ne 0) {
            throw "类型检查失败，退出代码：$LASTEXITCODE。"
        }
        npm test
        if ($LASTEXITCODE -ne 0) {
            throw "测试失败，退出代码：$LASTEXITCODE。"
        }
    }
    else {
        npm run make
        if ($LASTEXITCODE -ne 0) {
            throw "制作安装包失败，退出代码：$LASTEXITCODE。"
        }
    }
}
finally {
    Pop-Location
}
