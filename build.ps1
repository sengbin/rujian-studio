# ------------------------------------------------------------------------
# 名称：build.ps1
# 说明：构建 RUJIAN Studio 桌面应用；正式打包时将用户手册 Skill 一并打入。
# 作者：Lion
# 邮箱：chengbin@3578.cn
# 日期：2026-10-10
# 备注：文件需保存为带 BOM 的 UTF-8，否则 Windows PowerShell 5.1 会按 ANSI 读取而使中文乱码。
# ------------------------------------------------------------------------

<#
.SYNOPSIS
安装依赖并构建应用。
.DESCRIPTION
先安装依赖；默认生成用户手册 Skill 压缩包并制作安装包，指定 CheckOnly 时只运行类型检查与测试。
.PARAMETER CheckOnly
只执行类型检查与测试，不生成手册压缩包，也不制作安装包。
.EXAMPLE
.\build.ps1 -CheckOnly
#>
param(
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

# 用户手册 Skill 源目录
$manualSkillDirectory = Join-Path $PSScriptRoot 'skills\rujian-user-manual'
# “导出手册 Skill”读取的压缩包路径
$manualSkillArchive = Join-Path $PSScriptRoot 'resources\rujian-user-manual.zip'

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
        $manualSkillFile = Join-Path $manualSkillDirectory 'SKILL.md'
        if (-not (Test-Path -LiteralPath $manualSkillFile -PathType Leaf)) {
            throw "未找到用户使用手册 Skill 文件：$manualSkillFile"
        }

        # 压缩包必须在打包前生成，且压缩包根目录即 Skill 内容
        Compress-Archive -Path (Join-Path $manualSkillDirectory '*') -DestinationPath $manualSkillArchive -Force

        npm run make
        if ($LASTEXITCODE -ne 0) {
            throw "制作安装包失败，退出代码：$LASTEXITCODE。"
        }
    }
}
finally {
    Pop-Location
}
